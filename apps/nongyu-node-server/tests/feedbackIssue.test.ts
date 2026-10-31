import { describe, expect, it } from "vitest";
import {
  buildIssueBody,
  buildIssueTitle,
  isFeedbackIssueSyncEnabled,
} from "../src/modules/posts/feedbackIssue.js";
import { issueApiUrl, parseRepoSlug } from "../src/lib/github/issueClient.js";

describe("feedback wall issue sync", () => {
  describe("parseRepoSlug", () => {
    it("accepts owner/repo", () => {
      expect(parseRepoSlug("NongyuSystem/nongyu-system")).toEqual({
        owner: "NongyuSystem",
        repo: "nongyu-system",
      });
    });

    it("trims surrounding spaces", () => {
      expect(parseRepoSlug("  NongyuSystem/nongyu-system  ")).toEqual({
        owner: "NongyuSystem",
        repo: "nongyu-system",
      });
    });

    it("rejects missing slash", () => {
      expect(parseRepoSlug("nongyu-system")).toBeNull();
    });

    it("rejects extra segments", () => {
      expect(parseRepoSlug("a/b/c")).toBeNull();
    });

    it("rejects empty segment", () => {
      expect(parseRepoSlug("owner/")).toBeNull();
      expect(parseRepoSlug("/repo")).toBeNull();
    });

    it("rejects empty string", () => {
      expect(parseRepoSlug("")).toBeNull();
      expect(parseRepoSlug("   ")).toBeNull();
    });
  });

  describe("issueApiUrl", () => {
    it("builds the REST issues endpoint", () => {
      expect(issueApiUrl({ owner: "NongyuSystem", repo: "nongyu-system" })).toBe(
        "https://api.github.com/repos/NongyuSystem/nongyu-system/issues",
      );
    });
  });

  describe("buildIssueTitle", () => {
    it("prefixes with the feedback wall marker", () => {
      expect(buildIssueTitle("课表加载慢")).toBe("[反馈墙] 课表加载慢");
    });

    it("trims the post title", () => {
      expect(buildIssueTitle("  标题  ")).toBe("[反馈墙] 标题");
    });
  });

  describe("buildIssueBody", () => {
    it("contains post id, section, subtype label and content", () => {
      const body = buildIssueBody({
        postId: 123,
        subtype: "bug",
        title: "标题",
        content: "点进课表就白屏",
      });
      expect(body).toContain("| 帖子 ID | 123 |");
      expect(body).toContain("| 分区 | 反馈墙 |");
      expect(body).toContain("| 标签 | Bug |");
      expect(body).toContain("点进课表就白屏");
    });

    it("maps known subtypes to labels", () => {
      expect(
        buildIssueBody({ postId: 1, subtype: "suggestion", title: "t", content: "c" }),
      ).toContain("| 标签 | 建议 |");
      expect(
        buildIssueBody({ postId: 1, subtype: "feedback", title: "t", content: "c" }),
      ).toContain("| 标签 | 反馈 |");
    });

    it("falls back to raw subtype when unknown", () => {
      expect(buildIssueBody({ postId: 1, subtype: "unknown", title: "t", content: "c" })).toContain(
        "| 标签 | unknown |",
      );
    });

    it("does not leak author identity fields", () => {
      const body = buildIssueBody({ postId: 1, subtype: "bug", title: "t", content: "c" });
      expect(body).not.toContain("学号");
      expect(body).not.toContain("author");
    });
  });

  describe("isFeedbackIssueSyncEnabled", () => {
    it("returns false when GITHUB_TOKEN / GITHUB_REPO are unset", () => {
      expect(isFeedbackIssueSyncEnabled()).toBe(false);
    });
  });
});
