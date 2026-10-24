import { useThemeTokens } from "@/theme/ThemeProvider";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { AppLinearGradient } from "@/components/ui/AppLinearGradient";
import { JiaowuLoginPanel } from "@/modules/jiaowu/components/JiaowuLoginPanel";
import { guestGreeting } from "@/modules/mine/constants/avatar";
import { resolveLaunchHref } from "@/modules/settings/utils/resolveLaunchHref";
import { createThemedStyles } from "@/theme/createThemedStyles";

/**
 * 登录页欢迎语：时段问候 + 固定副文案
 */
function buildLoginWelcome(): string {
  return `${guestGreeting()}，很高兴在120岁的川农和可爱的你在农屿相遇，请你使用川农教务账号登录农屿`;
}

/**
 * 全局登录页：高级简约入口（无 App 图标）
 */
export function LoginScreen() {
  const styles = useStyles();
  const t = useThemeTokens();
  const insets = useSafeAreaInsets();
  const welcome = buildLoginWelcome();

  return (
    <AppLinearGradient
      colors={[t.color.primaryContainer, "rgba(250, 251, 250, 0.94)", t.color.background]}
      locations={[0, 0.42, 0.82]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.7, y: 1 }}
      style={styles.root}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + 48,
              paddingBottom: insets.bottom + t.space.xl,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.welcome}>
            <Text style={styles.welcomeText}>{welcome}</Text>
          </View>

          <JiaowuLoginPanel
            onSuccess={() => {
              router.replace(resolveLaunchHref());
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </AppLinearGradient>
  );
}

const useStyles = createThemedStyles((t) => ({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 28,
  },
  welcome: {
    marginBottom: 40,
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: "600",
    color: t.color.text,
    letterSpacing: 0.2,
    lineHeight: 34,
  },
}));
