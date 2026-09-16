import { Spin } from "antd";

export function RouteLoading() {
  return (
    <div className="relative z-[1] flex min-h-screen items-center justify-center bg-transparent">
      <div className="ny-canvas-wash" aria-hidden />
      <Spin size="large" />
    </div>
  );
}
