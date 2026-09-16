import { Link } from "react-router-dom";
import { ROUTES } from "../lib/constants";

export function NotFoundPage() {
  return (
    <div className="ny-glass rounded-2xl p-6 md:p-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">页面不存在</h1>
      <p className="mt-2 text-sm text-muted">没有找到对应的管理台页面。</p>
      <Link className="mt-6 inline-flex min-h-11 items-center text-brand" to={ROUTES.workspace}>
        返回工作台
      </Link>
    </div>
  );
}
