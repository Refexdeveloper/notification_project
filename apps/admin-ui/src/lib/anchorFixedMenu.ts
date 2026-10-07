export type AnchoredMenuStyle = {
  position: 'fixed';
  left: number;
  width: number;
  maxHeight: number;
  zIndex: number;
  top?: number | 'auto';
  bottom?: number;
};

/** Place a portaled menu/panel next to a trigger without clipping under a bottom sheet. */
export function anchorFixedMenu(
  rect: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>,
  {
    minWidth = 140,
    maxWidth = 448,
    estimatedHeight = 240,
    gutter = 12,
    zIndex = 12000,
  }: {
    minWidth?: number;
    maxWidth?: number;
    estimatedHeight?: number;
    gutter?: number;
    zIndex?: number;
  } = {},
): AnchoredMenuStyle {
  const vw = typeof window === 'undefined' ? 360 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 640 : window.innerHeight;
  const width = Math.min(maxWidth, Math.max(rect.width, minWidth), Math.max(gutter * 2, vw - gutter * 2));
  let left = rect.left;
  if (left + width > vw - gutter) left = Math.max(gutter, vw - width - gutter);
  if (left < gutter) left = gutter;
  const spaceBelow = vh - rect.bottom - gutter;
  const spaceAbove = rect.top - gutter;
  const preferUp = spaceBelow < Math.min(estimatedHeight, 180) && spaceAbove > spaceBelow;
  const maxHeight = Math.max(160, preferUp ? spaceAbove - 8 : spaceBelow - 8);
  if (preferUp) {
    return {
      position: 'fixed',
      left,
      width,
      maxHeight,
      bottom: Math.max(gutter, vh - rect.top + 8),
      top: 'auto',
      zIndex,
    };
  }
  return {
    position: 'fixed',
    left,
    width,
    maxHeight,
    top: rect.bottom + 8,
    zIndex,
  };
}
