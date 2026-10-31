/**
 * 对照探索笔记里的主机密文。只在本地跑，不发网络请求。
 */
import { encodeVpnHost, WEBVPN_KEY_HEX } from "./encode";

const expected = {
  "auth.sicau.edu.cn": "f1e25594692361537f1dc7a99c406d36ef",
  "jiaowu.sicau.edu.cn": "fafe409330252643770b88b9d65027203418e0",
} as const;

let failed = 0;
for (const [host, cipher] of Object.entries(expected)) {
  const segment = encodeVpnHost(host);
  const got = segment.slice(WEBVPN_KEY_HEX.length);
  if (got !== cipher) {
    failed += 1;
    console.error(`mismatch ${host}\n  got ${got}\n  exp ${cipher}`);
  } else {
    console.log(`ok ${host}`);
  }
}

if (failed > 0) {
  process.exit(1);
}
