package expo.modules.nongyuwebvpncookie

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.CookieHandler
import java.net.URI

/**
 * 通过 java.net.CookieHandler 读写 RN XHR 用的那只罐子。
 * 不用 android.webkit.CookieManager：那是 WebView 的罐子，和 OkHttp/XHR 不是同一份。
 * CookieHandler.get 会带回 HttpOnly 票据；页面脚本仍然读不到。
 */
class NongyuWebVpnCookieModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NongyuWebVpnCookie")

        AsyncFunction("readTicket") {
            readTicketValue()
        }

        AsyncFunction("writeTicket") { value: String ->
            writeTicketValue(value)
        }

        AsyncFunction("clearTicket") {
            clearTicketValue()
        }
    }

    private fun handler(): CookieHandler? = CookieHandler.getDefault()

    private fun cookieHeader(): String? {
        return try {
            val headers = handler()?.get(URI.create(ORIGIN), emptyMap()) ?: return null
            val raw = headers.entries.firstOrNull { it.key.equals("Cookie", ignoreCase = true) }?.value
            raw?.joinToString("; ")
        } catch (_: Exception) {
            null
        }
    }

    private fun readTicketValue(): String? {
        val raw = cookieHeader() ?: return null
        val pair = raw.split(";").map { it.trim() }.firstOrNull { it.startsWith("$TICKET_NAME=") }
            ?: return null
        val value = pair.substringAfter("=", "")
        return value.ifEmpty { null }
    }

    private fun writeTicketValue(value: String) {
        if (value.isEmpty()) return
        try {
            handler()?.put(
                URI.create(ORIGIN),
                mapOf("Set-Cookie" to listOf("$TICKET_NAME=$value; Path=/; Secure; HttpOnly")),
            )
        } catch (_: Exception) {
            // 罐子还没就绪时不抛给 JS
        }
    }

    private fun clearTicketValue() {
        try {
            handler()?.put(
                URI.create(ORIGIN),
                mapOf("Set-Cookie" to listOf("$TICKET_NAME=; Path=/; Max-Age=0")),
            )
        } catch (_: Exception) {
            // 退出登录不得因清票据失败而中断
        }
    }

    private companion object {
        const val ORIGIN = "https://webvpn.sicau.edu.cn/"
        const val TICKET_NAME = "wengine_vpn_ticketwebvpn_sicau_edu_cn"
    }
}
