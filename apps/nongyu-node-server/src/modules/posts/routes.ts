import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middlewares/common.js";
import { requireProvisionedAdminAuth, requireAppAuth } from "../../middlewares/auth.js";
import { ok } from "../../lib/response.js";
import { AppError, ErrorCodes } from "../../lib/errors.js";
import { toIsoUtc, toIsoUtcRequired } from "../../lib/time.js";
import { pageParams, previewText, normalizeListKeyword } from "../../lib/util.js";
import { countUsers } from "../users/repo.js";
import {
  findPostById,
  insertPost,
  latestAnnouncement,
  listPosts,
  recordPostRead,
  softDeletePost,
  updateAnnouncement,
} from "./repo.js";
import {
  consumeNewRepliesForUser,
  createAdminReply,
  createComment,
  countRepliesForPosts,
  getAdminReplyForPost,
  listCommentsForPost,
  listReceivedRepliesForUser,
  listSentCommentsForUser,
  softDeleteAdminReply,
  softDeleteCommentByAdmin,
  softDeleteCommentByOwner,
  updateAdminReply,
  PostGoneError,
  PostTypeNotAllowedError,
  ReplyAlreadyExistsError,
  ReplyNotFoundError,
} from "./postReplies.repo.js";
import { withTransaction } from "../../lib/db.js";
import { isFeedbackIssueSyncEnabled, syncFeedbackIssueAsync } from "./feedbackIssue.js";

export const appPostsRouter = Router();
export const adminPostsRouter = Router();

function appListItem(
  row: Awaited<ReturnType<typeof findPostById>>,
  opts?: { withViews?: boolean; replyCount?: number },
) {
  if (!row) return null;
  const base = {
    id: Number(row.id),
    postType: row.post_type,
    subtype: row.subtype,
    title: row.title,
    contentPreview: previewText(row.content),
    publishedAt: toIsoUtcRequired(row.published_at),
    // 反馈墙 / 大院对用户彼此匿名；署名仅 Admin 接口返回
    authorDisplayName: null,
  };
  const result: Record<string, unknown> = { ...base };
  if (opts?.withViews) {
    result.viewCount = row.view_count;
  }
  if (opts?.replyCount !== undefined) {
    result.replyCount = opts.replyCount;
    result.hasReply = opts.replyCount > 0;
  }
  return result;
}

appPostsRouter.get(
  "/",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        postType: z.enum(["announcement", "feedback", "courtyard"]),
        subtype: z.string().optional(),
        keyword: z.string().optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      })
      .parse(req.query);
    const keyword = normalizeListKeyword(query.keyword);
    const { page, pageSize, offset } = pageParams(query.page, query.pageSize);
    const { rows, total } = await listPosts({
      postType: query.postType,
      subtype: query.subtype,
      keyword,
      offset,
      pageSize,
    });
    ok(res, {
      list: rows.map((r) => appListItem(r)),
      total,
      page,
      pageSize,
    });
  }),
);

appPostsRouter.get(
  "/announcements/latest",
  requireAppAuth,
  asyncHandler(async (_req, res) => {
    const row = await latestAnnouncement();
    if (!row) {
      ok(res, null);
      return;
    }
    ok(res, {
      id: Number(row.id),
      title: row.title,
      subtype: row.subtype,
      publishedAt: toIsoUtcRequired(row.published_at),
    });
  }),
);

appPostsRouter.get(
  "/:id",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    await recordPostRead(id, req.appAuth!.uid);
    const refreshed = await findPostById(id);
    const base = {
      id: Number(refreshed!.id),
      postType: refreshed!.post_type,
      subtype: refreshed!.subtype,
      title: refreshed!.title,
      content: refreshed!.content,
      publishedAt: toIsoUtcRequired(refreshed!.published_at),
      authorDisplayName: null,
      isMine: Number(refreshed!.author_user_id) === req.appAuth!.uid,
    };
    // 反馈墙：附带管理员单条回复（用户侧统一「管理员回复」，不暴露管理员身份）
    if (refreshed!.post_type === "feedback") {
      const reply = await getAdminReplyForPost(id);
      ok(res, {
        ...base,
        adminReply: reply
          ? { content: reply.content, publishedAt: toIsoUtcRequired(reply.created_at) }
          : null,
      });
      return;
    }
    // 大院：附带顶层留言列表（完全匿名，仅 isMine 自识）
    if (refreshed!.post_type === "courtyard") {
      const comments = await listCommentsForPost(id);
      ok(res, {
        ...base,
        comments: comments.map((c) => ({
          id: Number(c.id),
          content: c.content,
          publishedAt: toIsoUtcRequired(c.created_at),
          isMine: Number(c.author_user_id) === req.appAuth!.uid,
        })),
      });
      return;
    }
    // 公告：不附带回复 / 留言
    ok(res, { ...base, adminReply: null, comments: [] });
  }),
);

appPostsRouter.post(
  "/:id/comments",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        content: z.string().trim().min(1, "留言内容不能为空").max(1000, "留言不超过1000字"),
      })
      .parse(req.body);
    try {
      const created = await withTransaction((conn) =>
        createComment(conn, id, req.appAuth!.uid, body.content),
      );
      ok(res, { id: created.id, publishedAt: toIsoUtcRequired(created.publishedAt) });
    } catch (err) {
      if (err instanceof PostGoneError) {
        throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
      }
      if (err instanceof PostTypeNotAllowedError) {
        throw new AppError(ErrorCodes.POST_TYPE_NOT_ALLOWED, "仅大院帖可留言", 400);
      }
      throw err;
    }
  }),
);

appPostsRouter.delete(
  "/:id/comments/:commentId",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    const removed = await softDeleteCommentByOwner(id, commentId, req.appAuth!.uid);
    if (!removed) {
      // 非本人或留言不存在：统一 403 避免泄露存在性
      throw new AppError(ErrorCodes.COMMENT_NOT_OWNED, "无权删除该留言", 403);
    }
    ok(res, { id: commentId });
  }),
);

appPostsRouter.post(
  "/",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        postType: z.enum(["feedback", "courtyard"]),
        subtype: z.string().min(1).max(32),
        title: z.string().min(1).max(200),
        content: z.string().min(1),
      })
      .parse(req.body);
    const id = await insertPost({
      postType: body.postType,
      subtype: body.subtype,
      title: body.title,
      content: body.content,
      authorUserId: req.appAuth!.uid,
    });
    // 反馈墙帖子落库后异步同步一条 GitHub Issue；失败只记日志，不影响发帖响应
    if (body.postType === "feedback" && isFeedbackIssueSyncEnabled()) {
      syncFeedbackIssueAsync({
        postId: Number(id),
        subtype: body.subtype,
        title: body.title,
        content: body.content,
      });
    }
    ok(res, { id });
  }),
);

appPostsRouter.delete(
  "/:id",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    if (post.post_type === "announcement" || Number(post.author_user_id) !== req.appAuth!.uid) {
      throw new AppError(ErrorCodes.ADMIN_REQUIRED, "无权删除该帖子", 403);
    }
    await softDeletePost(id);
    ok(res, null);
  }),
);

export const appMyPostsRouter = Router();

appMyPostsRouter.get(
  "/",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        postType: z.enum(["feedback", "courtyard"]).optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      })
      .parse(req.query);
    const { page, pageSize, offset } = pageParams(query.page, query.pageSize);
    const { rows, total } = await listPosts({
      authorUserId: req.appAuth!.uid,
      postType: query.postType,
      postTypes: query.postType ? undefined : ["feedback", "courtyard"],
      offset,
      pageSize,
    });
    const replyCountMap = await countRepliesForPosts(rows.map((r) => Number(r.id)));
    ok(res, {
      list: rows.map((r) =>
        appListItem(r, {
          withViews: true,
          replyCount: replyCountMap.get(Number(r.id)) ?? 0,
        }),
      ),
      total,
      page,
      pageSize,
    });
  }),
);

/** 轮询「我的帖子新回复」：返回未通知回复并同事务置位，供客户端 toast */
export const appMyPostRepliesRouter = Router();

appMyPostRepliesRouter.get(
  "/new",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const rows = await withTransaction((conn) => consumeNewRepliesForUser(conn, req.appAuth!.uid));
    ok(
      res,
      rows.map((r) => ({
        replyId: Number(r.replyId),
        postId: Number(r.postId),
        postType: r.postType,
        postTitle: r.postTitle,
        kind: r.kind,
        content: r.content,
        createdAt: toIsoUtcRequired(r.createdAt),
      })),
    );
  }),
);

/** 映射列表项：无作者字段；publishedAt 取回复 created_at */
function mapMyPostReplyListItem(r: {
  replyId: number;
  postId: number;
  postType: string;
  postTitle: string;
  kind: string;
  content: string;
  publishedAt: Date;
}) {
  return {
    replyId: Number(r.replyId),
    postId: Number(r.postId),
    postType: r.postType,
    postTitle: r.postTitle,
    kind: r.kind,
    content: r.content,
    publishedAt: toIsoUtcRequired(r.publishedAt),
  };
}

/** 收到的回复 inbox（帖主视角，排除自留言） */
appMyPostRepliesRouter.get(
  "/received",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      })
      .parse(req.query);
    const { page, pageSize, offset } = pageParams(query.page, query.pageSize);
    const { rows, total } = await listReceivedRepliesForUser({
      userId: req.appAuth!.uid,
      offset,
      pageSize,
    });
    ok(res, {
      list: rows.map(mapMyPostReplyListItem),
      total,
      page,
      pageSize,
    });
  }),
);

/** 我发出的留言（对他人大院帖） */
appMyPostRepliesRouter.get(
  "/sent",
  requireAppAuth,
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      })
      .parse(req.query);
    const { page, pageSize, offset } = pageParams(query.page, query.pageSize);
    const { rows, total } = await listSentCommentsForUser({
      userId: req.appAuth!.uid,
      offset,
      pageSize,
    });
    ok(res, {
      list: rows.map(mapMyPostReplyListItem),
      total,
      page,
      pageSize,
    });
  }),
);

adminPostsRouter.get(
  "/",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        postType: z.enum(["announcement", "feedback", "courtyard"]).optional(),
        subtype: z.string().optional(),
        keyword: z.string().optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
        includeDeleted: z
          .union([z.literal("true"), z.literal("false"), z.boolean()])
          .optional()
          .transform((v) => v === true || v === "true"),
        sortBy: z.enum(["viewCount", "replyCount"]).optional(),
        sortOrder: z.enum(["asc", "desc"]).optional(),
      })
      .superRefine((val, ctx) => {
        if (val.sortOrder !== undefined && val.sortBy === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "sortOrder 须配合 sortBy 使用",
            path: ["sortOrder"],
          });
        }
      })
      .parse(req.query);
    const keyword = normalizeListKeyword(query.keyword);
    const { page, pageSize, offset } = pageParams(query.page, query.pageSize);
    const totalUsers = await countUsers();
    const { rows, total } = await listPosts({
      postType: query.postType,
      subtype: query.subtype,
      keyword,
      includeDeleted: query.includeDeleted,
      sortBy: query.sortBy,
      sortOrder: query.sortBy ? (query.sortOrder ?? "desc") : undefined,
      offset,
      pageSize,
    });
    const replyCountMap = await countRepliesForPosts(rows.map((r) => Number(r.id)));
    ok(res, {
      list: rows.map((r) => ({
        id: Number(r.id),
        postType: r.post_type,
        subtype: r.subtype,
        title: r.title,
        content: r.content,
        authorUserId: Number(r.author_user_id),
        authorStudentNo: r.author_student_no ?? "",
        authorName: r.author_name ?? "",
        viewCount: r.view_count,
        uniqueReaderCount: r.unique_reader_count,
        coverageRate: totalUsers > 0 ? r.unique_reader_count / totalUsers : 0,
        publishedAt: toIsoUtcRequired(r.published_at),
        deletedAt: toIsoUtc(r.deleted_at),
        replyCount: replyCountMap.get(Number(r.id)) ?? 0,
      })),
      total,
      page,
      pageSize,
    });
  }),
);

adminPostsRouter.get(
  "/:id",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const post = await findPostById(id);
    if (!post) throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    const totalUsers = await countUsers();
    const base = {
      id: Number(post.id),
      postType: post.post_type,
      subtype: post.subtype,
      title: post.title,
      content: post.content,
      authorUserId: Number(post.author_user_id),
      authorStudentNo: post.author_student_no ?? "",
      authorName: post.author_name ?? "",
      viewCount: post.view_count,
      uniqueReaderCount: post.unique_reader_count,
      coverageRate: totalUsers > 0 ? post.unique_reader_count / totalUsers : 0,
      publishedAt: toIsoUtcRequired(post.published_at),
      deletedAt: toIsoUtc(post.deleted_at),
    };
    // 已删除帖：回复 / 留言随级联软删，不返回（避免脏数据）
    if (post.deleted_at) {
      ok(res, { ...base, adminReply: null, comments: [] });
      return;
    }
    const adminReply = await getAdminReplyForPost(id);
    const comments = await listCommentsForPost(id);
    ok(res, {
      ...base,
      adminReply: adminReply
        ? {
            id: Number(adminReply.id),
            content: adminReply.content,
            publishedAt: toIsoUtcRequired(adminReply.created_at),
            updatedAt: toIsoUtcRequired(adminReply.updated_at),
            authorUserId: Number(adminReply.author_user_id),
            authorStudentNo: adminReply.author_student_no ?? "",
            authorName: adminReply.author_name ?? "",
          }
        : null,
      comments: comments.map((c) => ({
        id: Number(c.id),
        content: c.content,
        publishedAt: toIsoUtcRequired(c.created_at),
        authorUserId: Number(c.author_user_id),
        authorStudentNo: c.author_student_no ?? "",
        authorName: c.author_name ?? "",
      })),
    });
  }),
);

adminPostsRouter.post(
  "/:id/reply",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        content: z.string().trim().min(1, "回复内容不能为空").max(2000, "回复不超过2000字"),
      })
      .parse(req.body);
    try {
      const created = await withTransaction((conn) =>
        createAdminReply(conn, id, req.adminAuth!.uid, body.content),
      );
      ok(res, {
        id: created.id,
        content: body.content,
        publishedAt: toIsoUtcRequired(created.publishedAt),
      });
    } catch (err) {
      if (err instanceof PostGoneError) {
        throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
      }
      if (err instanceof PostTypeNotAllowedError) {
        throw new AppError(ErrorCodes.POST_TYPE_NOT_ALLOWED, "仅反馈墙帖可回复", 400);
      }
      if (err instanceof ReplyAlreadyExistsError) {
        throw new AppError(ErrorCodes.POST_REPLY_EXISTS, "该帖已有回复，请改用更新", 409);
      }
      throw err;
    }
  }),
);

adminPostsRouter.patch(
  "/:id/reply",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = z
      .object({
        content: z.string().trim().min(1, "回复内容不能为空").max(2000, "回复不超过2000字"),
      })
      .parse(req.body);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    if (post.post_type !== "feedback") {
      throw new AppError(ErrorCodes.POST_TYPE_NOT_ALLOWED, "仅反馈墙帖可回复", 400);
    }
    try {
      const updated = await withTransaction((conn) => updateAdminReply(conn, id, body.content));
      ok(res, {
        id: updated.id,
        content: body.content,
        publishedAt: toIsoUtcRequired(updated.publishedAt),
      });
    } catch (err) {
      if (err instanceof ReplyNotFoundError) {
        throw new AppError(ErrorCodes.POST_REPLY_NOT_FOUND, "管理员回复不存在", 404);
      }
      throw err;
    }
  }),
);

adminPostsRouter.delete(
  "/:id/reply",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    try {
      await withTransaction((conn) => softDeleteAdminReply(conn, id));
    } catch (err) {
      if (err instanceof ReplyNotFoundError) {
        throw new AppError(ErrorCodes.POST_REPLY_NOT_FOUND, "管理员回复不存在", 404);
      }
      throw err;
    }
    ok(res, { id });
  }),
);

adminPostsRouter.delete(
  "/:id/comments/:commentId",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const commentId = Number(req.params.commentId);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    const removed = await softDeleteCommentByAdmin(id, commentId);
    if (!removed) {
      throw new AppError(ErrorCodes.COMMENT_NOT_FOUND, "留言不存在", 404);
    }
    ok(res, { id: commentId });
  }),
);

adminPostsRouter.post(
  "/",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        subtype: z.string().min(1).max(32),
        title: z.string().min(1).max(200),
        content: z.string().min(1),
        publishedAt: z.string().datetime().optional(),
        postType: z.literal("announcement").optional(),
      })
      .parse(req.body);
    const id = await insertPost({
      postType: "announcement",
      subtype: body.subtype,
      title: body.title,
      content: body.content,
      authorUserId: req.adminAuth!.uid,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    });
    ok(res, { id });
  }),
);

adminPostsRouter.patch(
  "/:id",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    if (post.post_type !== "announcement") {
      throw new AppError(ErrorCodes.VALIDATION, "本版仅允许编辑公告", 400);
    }
    const body = z
      .object({
        subtype: z.string().min(1).max(32).optional(),
        title: z.string().min(1).max(200).optional(),
        content: z.string().min(1).optional(),
        publishedAt: z.string().datetime().optional(),
      })
      .parse(req.body);
    await updateAnnouncement(id, {
      ...body,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
    });
    ok(res, { id });
  }),
);

adminPostsRouter.delete(
  "/:id",
  requireProvisionedAdminAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const post = await findPostById(id);
    if (!post || post.deleted_at) {
      throw new AppError(ErrorCodes.POST_NOT_FOUND, "帖子不存在", 404);
    }
    await softDeletePost(id);
    ok(res, null);
  }),
);
