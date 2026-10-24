import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { JiaowuCaptcha } from "nongyu-tool-jiaowu";
import { toast } from "@/components/ui/toast";
import { useThemeTokens } from "@/theme/ThemeProvider";
import { createThemedStyles } from "@/theme/createThemedStyles";
import { JiaowuLoginForm } from "@/modules/jiaowu/components/JiaowuLoginForm";
import {
  bridgeGetJiaowuCaptcha,
  bridgeSendJiaowuSmsCode,
} from "@/modules/jiaowu/auth/jiaowuSession";
import {
  performHostedJiaowuLogin,
  performPhoneJiaowuLogin,
} from "@/modules/jiaowu/auth/performJiaowuLogin";

type LoginMethod = "auto" | "password" | "phone" | "wechat";

const METHODS: Array<{ key: LoginMethod; label: string; hint: string }> = [
  { key: "auto", label: "自动登录", hint: "开启后无需验证码" },
  { key: "password", label: "账密", hint: "需输入图形验证码" },
  { key: "phone", label: "手机验证码", hint: "短信确认身份" },
  { key: "wechat", label: "微信", hint: "扫码登录" },
];

type Props = {
  onSuccess?: () => void;
};

/**
 * 教务登录方式选择器。
 *
 * 教务系统取消首页账号密码登录后，客户端能走的入口有三类：
 * 1. 账密 + 图形验证码（每次都要读图）
 * 2. 手机短信验证码（发短信前仍需一次图形码）
 * 3. 微信扫码（川农微教务绑定后扫码，非自动）
 *
 * 「自动登录」是在 1 的基础上，用户授权服务端加密保存密码，
 * 由服务端完成 OCR 与登录，日常使用时不再需要读验证码。
 */
export function JiaowuLoginPanel({ onSuccess }: Props) {
  const styles = useStyles();
  const t = useThemeTokens();
  const [method, setMethod] = useState<LoginMethod>("auto");

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {METHODS.map((item) => {
          const active = item.key === method;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setMethod(item.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={styles.tabHint}>{METHODS.find((m) => m.key === method)?.hint}</Text>

      {method === "auto" ? <AutoLoginPane onSuccess={onSuccess} /> : null}
      {method === "password" ? <JiaowuLoginForm onSuccess={onSuccess} /> : null}
      {method === "phone" ? <PhoneLoginPane onSuccess={onSuccess} /> : null}
      {method === "wechat" ? <WechatPane /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ 自动登录 */

function AutoLoginPane({ onSuccess }: Props) {
  const styles = useStyles();
  const t = useThemeTokens();
  const queryClient = useQueryClient();
  const [studentNo, setStudentNo] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = studentNo.trim().length > 0 && password.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!agreed) {
      toast.error("请先阅读并同意凭据托管说明");
      return;
    }
    setSubmitting(true);
    try {
      const result = await performHostedJiaowuLogin({
        studentNo,
        password,
        enableHosted: true,
        queryClient,
      });
      if (!result.ok) {
        toast.error("自动登录失败", { description: result.message });
        return;
      }
      toast.success("已开启免验证码自动登录");
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.pane}>
      <TextInput
        style={styles.input}
        placeholder="学号"
        placeholderTextColor={t.color.textSecondary}
        keyboardType="number-pad"
        autoCapitalize="none"
        autoCorrect={false}
        value={studentNo}
        onChangeText={setStudentNo}
        editable={!submitting}
      />
      <TextInput
        style={styles.input}
        placeholder="统一身份认证密码"
        placeholderTextColor={t.color.textSecondary}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!submitting}
        onSubmitEditing={handleSubmit}
      />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        onPress={() => setAgreed((v) => !v)}
        style={styles.agreeRow}
      >
        <Ionicons
          name={agreed ? "checkbox" : "square-outline"}
          size={18}
          color={agreed ? t.color.brand : t.color.textSecondary}
        />
        <Text style={styles.agreeText}>
          我同意农屿服务器加密保存教务密码，用于自动完成登录（可随时在设置中关闭并删除）
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        disabled={!canSubmit}
        onPress={handleSubmit}
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed && styles.pressed,
          (!canSubmit || submitting) && styles.disabled,
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={t.color.onBrand} />
        ) : (
          <Text style={styles.primaryBtnText}>开启并登录</Text>
        )}
      </Pressable>

      <Text style={styles.note}>
        开启后由服务端识别验证码并自动登录，日常无需再读图；想收回授权可在「我的 → 设置」关闭。
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------ 手机验证码登录 */

function PhoneLoginPane({ onSuccess }: Props) {
  const styles = useStyles();
  const t = useThemeTokens();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [studentId, setStudentId] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [captcha, setCaptcha] = useState<JiaowuCaptcha | null>(null);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaCode("");
    try {
      const res = await bridgeGetJiaowuCaptcha();
      if (res.success) setCaptcha(res.result);
      else setCaptcha(null);
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = async () => {
    if (!phone.trim()) {
      toast.error("请输入手机号");
      return;
    }
    if (!captcha || !captchaCode.trim()) {
      toast.error("请输入图形验证码");
      return;
    }
    const res = await bridgeSendJiaowuSmsCode({
      phone,
      captchaCode,
      captchaUuid: captcha.uuid,
    });
    if (!res.success) {
      toast.error("短信发送失败", { description: res.message });
      void loadCaptcha();
      return;
    }
    setCountdown(60);
    toast.success("验证码已发送");
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!smsCode.trim()) {
      toast.error("请输入短信验证码");
      return;
    }
    setSubmitting(true);
    try {
      const result = await performPhoneJiaowuLogin({
        phone,
        smsCode,
        studentId,
        queryClient,
      });
      if (!result.ok) {
        toast.error("登录失败", { description: result.message });
        return;
      }
      onSuccess?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.pane}>
      <TextInput
        style={styles.input}
        placeholder="手机号"
        placeholderTextColor={t.color.textSecondary}
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        editable={!submitting}
      />
      <TextInput
        style={styles.input}
        placeholder="学号（用于展示档案）"
        placeholderTextColor={t.color.textSecondary}
        keyboardType="number-pad"
        value={studentId}
        onChangeText={setStudentId}
        editable={!submitting}
      />
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder="图形验证码"
          placeholderTextColor={t.color.textSecondary}
          autoCapitalize="characters"
          maxLength={6}
          value={captchaCode}
          onChangeText={setCaptchaCode}
          editable={!submitting}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="换一张验证码"
          onPress={() => void loadCaptcha()}
          style={styles.captchaBtn}
        >
          {captchaLoading || !captcha ? (
            <ActivityIndicator size="small" color={t.color.textSecondary} />
          ) : (
            <Image source={{ uri: captcha.image }} style={styles.captchaImg} resizeMode="contain" />
          )}
        </Pressable>
      </View>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder="短信验证码"
          placeholderTextColor={t.color.textSecondary}
          keyboardType="number-pad"
          value={smsCode}
          onChangeText={setSmsCode}
          editable={!submitting}
        />
        <Pressable
          accessibilityRole="button"
          disabled={countdown > 0}
          onPress={handleSendCode}
          style={[styles.sendBtn, countdown > 0 && styles.disabled]}
        >
          <Text style={styles.sendBtnText}>{countdown > 0 ? `${countdown}s` : "获取验证码"}</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={handleSubmit}
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed && styles.pressed,
          submitting && styles.disabled,
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={t.color.onBrand} />
        ) : (
          <Text style={styles.primaryBtnText}>登录</Text>
        )}
      </Pressable>
      <Text style={styles.note}>发短信前仍需一次图形验证码，这是统一身份认证平台的要求。</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- 微信扫码 */

function WechatPane() {
  const styles = useStyles();
  const t = useThemeTokens();

  const openJiaowu = () => {
    void Linking.openURL("https://jiaowu.sicau.edu.cn/web/web/web/index.asp");
  };

  return (
    <View style={styles.pane}>
      <Text style={styles.wechatTitle}>使用微信扫码登录</Text>
      <Text style={styles.wechatStep}>1. 打开浏览器进入教务系统首页，点「扫码登录」</Text>
      <Text style={styles.wechatStep}>
        2. 首次使用需在「川农微教务」公众号绑定教务账号（我的教务 → 学生账号绑定）
      </Text>
      <Text style={styles.wechatStep}>3. 扫码确认后回到农屿，用「自动登录」或「账密」进入</Text>
      <Pressable
        accessibilityRole="button"
        onPress={openJiaowu}
        style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
      >
        <Text style={styles.primaryBtnText}>打开教务系统</Text>
      </Pressable>
      <Text style={styles.note}>
        微信扫码属于人工确认流程，无法自动完成；如需完全免验证码，请使用「自动登录」。
      </Text>
    </View>
  );
}

const useStyles = createThemedStyles((t) => ({
  wrap: { width: "100%" },
  tabs: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    backgroundColor: t.color.surface,
  },
  tabActive: { backgroundColor: t.color.brand, borderColor: t.color.brand },
  tabLabel: { fontSize: 13, color: t.color.textSecondary, fontWeight: "500" },
  tabLabelActive: { color: t.color.onBrand },
  tabHint: {
    marginTop: 8,
    marginBottom: 18,
    fontSize: 12,
    color: t.color.textSecondary,
    opacity: 0.7,
  },
  pane: { gap: 14 },
  input: {
    backgroundColor: t.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.space.md,
    paddingVertical: 13,
    fontSize: t.fontSize.md,
    color: t.color.text,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex: { flex: 1 },
  captchaBtn: {
    width: 108,
    height: 46,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: t.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border,
  },
  captchaImg: { width: 104, height: 40 },
  sendBtn: {
    paddingHorizontal: 14,
    height: 46,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.brand,
  },
  sendBtnText: { fontSize: 13, color: t.color.brand, fontWeight: "600" },
  agreeRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  agreeText: { flex: 1, fontSize: 12, lineHeight: 18, color: t.color.textSecondary },
  primaryBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: t.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: t.color.onBrand, fontSize: 16, fontWeight: "600", letterSpacing: 1.2 },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.45 },
  note: { fontSize: 12, lineHeight: 18, color: t.color.textSecondary, opacity: 0.6 },
  wechatTitle: { fontSize: 15, fontWeight: "600", color: t.color.text },
  wechatStep: { fontSize: 13, lineHeight: 20, color: t.color.textSecondary },
}));
