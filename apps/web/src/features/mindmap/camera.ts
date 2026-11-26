/**
 * 画布相机（平移 + 缩放）。
 *
 * 约定：屏幕坐标 = `cam.x + world * cam.zoom`，世界坐标原点就是导图根节点的中心。
 * 之所以把换算写成纯函数：
 * - 缩放要「以指针为锚点」，公式一旦写反，表现是「越缩放越跑偏」，很难肉眼判断；
 * - 适应画布 / 按钮缩放 / 双指缩放都需要同一套夹紧逻辑（25%–200%）。
 */

export interface Camera {
  /** 世界原点在容器内的屏幕 x（px，相对容器左上角） */
  x: number;
  /** 世界原点在容器内的屏幕 y */
  y: number;
  /** 25% – 200% */
  zoom: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
/** 按钮缩放的每一档倍率 */
export const ZOOM_STEP = 1.2;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 屏幕（相对容器）→ 世界 */
export function screenToWorld(camera: Camera, screenX: number, screenY: number): Point {
  const zoom = camera.zoom || 1;
  return { x: (screenX - camera.x) / zoom, y: (screenY - camera.y) / zoom };
}

/** 世界 → 屏幕（相对容器） */
export function worldToScreen(camera: Camera, worldX: number, worldY: number): Point {
  return { x: camera.x + worldX * camera.zoom, y: camera.y + worldY * camera.zoom };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  if (!dx && !dy) return camera;
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/**
 * 以屏幕上的某一点为锚缩放：缩放前后锚点下的世界坐标保持不变。
 * 触控板双指、Ctrl+滚轮、`+ / −` 按钮（锚点为容器中心）都走它。
 */
export function zoomAtPoint(camera: Camera, nextZoom: number, anchorX: number, anchorY: number): Camera {
  const zoom = clampZoom(nextZoom);
  if (zoom === camera.zoom) return camera;
  const world = screenToWorld(camera, anchorX, anchorY);
  return { x: anchorX - world.x * zoom, y: anchorY - world.y * zoom, zoom };
}

/** 按钮缩放：以容器中心为锚，按 ZOOM_STEP 步进，夹在 25%–200%。 */
export function zoomStep(camera: Camera, direction: -1 | 1, viewport: ViewportSize): Camera {
  const anchorX = viewport.width / 2;
  const anchorY = viewport.height / 2;
  const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomAtPoint(camera, camera.zoom * factor, anchorX, anchorY);
}

/**
 * 适应画布：把内容的包围盒放进容器，留出 padding。
 *
 * 放大上限固定在 100%：一个只有三五个节点的图被拉到 200% 只会显得空荡，
 * 用户想看细节可以自己按 `+`。
 */
export function fitCamera(
  bounds: Bounds,
  viewport: ViewportSize,
  padding = 56,
  maxZoom = 1,
): Camera {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);

  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    return { x: viewport.width / 2, y: viewport.height / 2, zoom: 1 };
  }

  const zoom = clampZoom(
    Math.min(maxZoom, availableWidth / bounds.width, availableHeight / bounds.height),
  );
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;

  return {
    x: viewport.width / 2 - centerX * zoom,
    y: viewport.height / 2 - centerY * zoom,
    zoom,
  };
}

/** 世界里的可见矩形（含 margin）：裁剪节点用。 */
export function visibleWorldRect(
  camera: Camera,
  viewport: ViewportSize,
  margin = 400,
): Bounds {
  const zoom = camera.zoom || 1;
  const minX = (0 - camera.x) / zoom - margin;
  const minY = (0 - camera.y) / zoom - margin;
  const maxX = (viewport.width - camera.x) / zoom + margin;
  const maxY = (viewport.height - camera.y) / zoom + margin;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** 某个世界坐标点是否在当前视口内（用于「新建节点后把它带进视野」）。 */
export function isPointVisible(
  camera: Camera,
  viewport: ViewportSize,
  worldX: number,
  worldY: number,
  padding = 80,
): boolean {
  const screen = worldToScreen(camera, worldX, worldY);
  return (
    screen.x >= padding &&
    screen.x <= viewport.width - padding &&
    screen.y >= padding &&
    screen.y <= viewport.height - padding
  );
}

/** 把一个世界坐标点居中显示（保持缩放），用于「定位到刚建的节点」。 */
export function centerOn(camera: Camera, viewport: ViewportSize, worldX: number, worldY: number): Camera {
  return {
    zoom: camera.zoom,
    x: viewport.width / 2 - worldX * camera.zoom,
    y: viewport.height / 2 - worldY * camera.zoom,
  };
}

/**
 * 视口中心的世界坐标。
 *
 * 导图的「视口」按**屏幕中心落在世界的哪个点**来存，而不是存像素偏移：
 * 像素偏移只在「当时那个窗口尺寸」下成立，换一台设备（或把窗口拉窄）打开时
 * 内容会整块偏出画布。存世界中心 + 缩放，任何尺寸下都能还原到同一处。
 */
export function cameraCenter(camera: Camera, viewport: ViewportSize): Point {
  return screenToWorld(camera, viewport.width / 2, viewport.height / 2);
}

/** 由「世界中心 + 缩放」还原相机（cameraCenter 的逆运算）。 */
export function cameraFromCenter(center: Point, zoom: number, viewport: ViewportSize): Camera {
  const nextZoom = clampZoom(zoom);
  return {
    zoom: nextZoom,
    x: viewport.width / 2 - center.x * nextZoom,
    y: viewport.height / 2 - center.y * nextZoom,
  };
}

/** 点阵背景的网格间距：跟着缩放走，但保证屏幕上不小于 12px，避免变成一团噪点。 */
export function gridStep(zoom: number, base = 24): number {
  let step = base * zoom;
  while (step < 12) step *= 2;
  return step;
}
