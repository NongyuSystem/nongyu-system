import { useThemeTokens } from "@/theme/ThemeProvider";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { JiaowuCaptcha } from "nongyu-tool-jiaowu";
import { toast } from "@/components/ui/toast";
import { createThemedStyles } from "@/theme/createThemedStyles";
import { performJiaowuLogin } from "@/modules/jiaowu/auth/performJiaowuLogin";
import { bridgeGetJiaowuCaptcha } from "@/modules/jiaowu/auth/jiaowuSession";
import { trackClick } from "@/modules/telemetry";

type JiaowuLoginFormProps = {
  /** 登录成功回调 */
  onSuccess?: () => void;
  /** 紧凑模式（嵌入教务首页） */
  compact?: boolean;
};

const STUDENT_ID_RE = /^\d{9}$/;

/**
 * 教务登录表单（全局登录页与教务页内共用）
 *
 * 教务自 2026-10-23 起取消首页账号密码登录，改为统一身份认证，
 * 因此表单在学号/密码之外多一个**用户必须自己看、自己输**的图形验证码：
 * 验证码由学校统一身份认证平台下发，不做 OCR —— 机器识别会让用户卡在登录页，
 * 而且平台正是用这张图区分人与脚本。
 *
 * 非 compact：高级简约下划线输入；compact 保持教务页嵌入样式
 */
export function JiaowuLoginForm({ onSuccess, compact }: JiaowuLoginFormProps) {
  const styles = useStyles();
  const t = useThemeTokens();
  const queryClient = useQueryClient();
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captcha, setCaptcha] = useState<JiaowuCaptcha | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idError, setIdError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("");

  /**
   * 换一张验证码。任何一次登录失败后都要调用：
   * 验证码是一次性的，失败后旧图必然作废，留着只会让用户反复提交同一张废图。
   */
  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaCode("");
    try {
      const res = await bridgeGetJiaowuCaptcha();
      if (res.success) {
        setCaptcha(res.result);
      } else {
        setCaptcha(null);
        toast.error("验证码获取失败", { description: res.message });
      }
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  /** 学号、密码、验证码都填了才可点；学号格式仅在 submit 校验 */
  const canSubmit =
    password.trim().length > 0 && captchaCode.trim().length > 0 && !!captcha && !submitting;

  const onChangeStudentId = (value: string) => {
    setStudentId(value);
    if (idError) setIdError(null);
  };

  const handleSubmit = async () => {
    trackClick("jiaowu_login");
    if (submitting) return;
    if (!STUDENT_ID_RE.test(studentId.trim())) {
      setIdError("学号需为 9 位数字");
      toast.error("学号需为 9 位数字");
      return;
    }
    if (!password.trim()) {
      toast.error("请输入教务密码");
      return;
    }
    if (!captcha || !captchaCode.trim()) {
      toast.error("请输入图形验证码");
      return;
    }

    setSubmitting(true);
    setStatusText("正在验证…");
    try {
      const result = await performJiaowuLogin({
        studentId,
        password,
        captchaCode,
        captchaUuid: captcha.uuid,
        queryClient,
      });
      if (!result.ok) {
        setStatusText("");
        toast.error("登录失败", {
          description: result.message || "请检查学号密码与验证码",
        });
        // 不论失败原因，验证码都已作废，直接换一张
        void loadCaptcha();
        return;
      }
      setStatusText("");
      toast.success("感谢你使用农屿");
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  };

  /** 验证码图：加载中 / 未取到时显示占位，点一下换一张 */
  const renderCaptchaImage = () => {
    if (captchaLoading || !captcha) {
      return <ActivityIndicator size="small" color={t.color.textSecondary} />;
    }
    return (
      <Image
        source={{ uri: captcha.image }}
        style={styles.captchaImg}
        resizeMode="contain"
        accessibilityLabel="图形验证码，点击换一张"
      />
    );
  };

  if (compact) {
    return (
      <View style={[styles.wrap, styles.compact]}>
        <Text style={styles.compactTitle}>登录后解锁成绩、考试等服务</Text>
        <TextInput
          style={styles.inputCompact}
          placeholder="学号"
          placeholderTextColor={t.color.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          value={studentId}
          onChangeText={onChangeStudentId}
          editable={!submitting}
        />
        {idError ? <Text style={styles.errTip}>{idError}</Text> : null}
        <TextInput
          style={styles.inputCompact}
          placeholder="统一身份认证密码"
          placeholderTextColor={t.color.textSecondary}
          secureTextEntry={!showPassword}
          value={password}
          onChangeText={setPassword}
          editable={!submitting}
        />
        <View style={styles.captchaRow}>
          <TextInput
            style={[styles.inputCompact, styles.captchaInput]}
            placeholder="图形验证码"
            placeholderTextColor={t.color.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            value={captchaCode}
            onChangeText={setCaptchaCode}
            editable={!submitting}
            onSubmitEditing={handleSubmit}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="换一张验证码"
            hitSlop={6}
            onPress={() => void loadCaptcha()}
            style={styles.captchaBtn}
          >
            {renderCaptchaImage()}
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="登录"
          disabled={!canSubmit}
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.buttonCompact,
            pressed && styles.pressed,
            (!canSubmit || submitting) && styles.disabled,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={t.color.onBrand} />
          ) : (
            <Text style={styles.buttonText}>登录</Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>学号</Text>
        <TextInput
          style={[styles.inputLine, idError ? styles.inputLineError : null]}
          placeholder="9 位数字学号"
          placeholderTextColor="rgba(66, 73, 69, 0.45)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          maxLength={9}
          value={studentId}
          onChangeText={onChangeStudentId}
          editable={!submitting}
        />
        {idError ? <Text style={styles.errTip}>{idError}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>统一身份认证密码</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.inputLine, styles.passwordInput]}
            placeholder="川农 e 认证密码"
            placeholderTextColor="rgba(66, 73, 69, 0.45)"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            editable={!submitting}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "隐藏密码" : "显示密码"}
            hitSlop={8}
            onPress={() => setShowPassword((v) => !v)}
            style={styles.eyeBtn}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={t.color.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>图形验证码</Text>
        <View style={styles.captchaRow}>
          <TextInput
            style={[styles.inputLine, styles.captchaInput]}
            placeholder="输入图中字符"
            placeholderTextColor="rgba(66, 73, 69, 0.45)"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            value={captchaCode}
            onChangeText={setCaptchaCode}
            editable={!submitting}
            onSubmitEditing={handleSubmit}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="换一张验证码"
            hitSlop={6}
            onPress={() => void loadCaptcha()}
            style={styles.captchaBtn}
          >
            {renderCaptchaImage()}
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="进入农屿"
        disabled={!canSubmit}
        onPress={handleSubmit}
        style={({ pressed }) => [
          styles.enterBtn,
          pressed && styles.pressed,
          (!canSubmit || submitting) && styles.disabled,
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={t.color.onBrand} />
        ) : (
          <Text style={styles.enterBtnText}>开启农屿之旅</Text>
        )}
      </Pressable>

      {submitting || statusText ? (
        <View style={styles.statusRow}>
          {submitting ? <ActivityIndicator color={t.color.brand} /> : null}
          {statusText ? <Text style={styles.statusText}>{statusText}</Text> : null}
        </View>
      ) : null}

      <Text style={styles.tipsText}>
        教务系统已启用统一身份认证，验证码由川农 e 认证下发，请照图输入
      </Text>
      <Text style={styles.tipsText}>农屿承诺不会在远程保存您的教务密码，请放心使用</Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  wrap: {
    width: "100%",
  },
  compact: {
    marginTop: t.space.md,
    padding: t.space.md,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    gap: t.space.sm,
  },
  compactTitle: {
    fontSize: t.fontSize.sm,
    color: t.color.textSecondary,
    marginBottom: 4,
  },
  field: {
    marginBottom: 22,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: t.color.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.6,
  },
  /** 下划线输入：少边框、少圆角块，偏编辑感 */
  inputLine: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(10, 124, 89, 0.22)",
    paddingHorizontal: 0,
    paddingVertical: 12,
    fontSize: 17,
    fontWeight: "500",
    color: t.color.text,
  },
  inputLineError: {
    borderBottomColor: t.color.danger,
  },
  inputCompact: {
    backgroundColor: t.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.md,
    paddingVertical: 12,
    fontSize: t.fontSize.md,
    color: t.color.text,
  },
  passwordRow: {
    position: "relative",
    justifyContent: "center",
  },
  passwordInput: {
    paddingRight: 40,
  },
  eyeBtn: {
    position: "absolute",
    right: 0,
    height: "100%",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  /** 验证码：输入框与图片同一行，图片可点换图 */
  captchaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  captchaInput: {
    flex: 1,
  },
  captchaBtn: {
    width: 108,
    height: 44,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: t.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
  },
  captchaImg: {
    width: 104,
    height: 40,
  },
  errTip: {
    fontSize: 12,
    color: t.color.danger,
    marginTop: 8,
  },
  enterBtn: {
    marginTop: 12,
    height: 50,
    borderRadius: 14,
    backgroundColor: t.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  enterBtnText: {
    color: t.color.onBrand,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 1.2,
  },
  buttonCompact: {
    marginTop: t.space.sm,
    backgroundColor: t.color.brand,
    paddingVertical: 14,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  buttonText: {
    color: t.color.onBrand,
    fontSize: t.fontSize.md,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.45,
  },
  statusRow: {
    marginTop: 18,
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  statusText: {
    fontSize: 13,
    color: t.color.textSecondary,
  },
  tipsText: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: t.color.textSecondary,
    opacity: 0.55,
    textAlign: "center",
  },
}));
