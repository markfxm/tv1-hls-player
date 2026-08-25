export function calculateNodeFlyoutPosition({ toggleRect, listRect, viewportWidth, viewportHeight }) {
  if (!toggleRect || !listRect) {
    return null;
  }

  if (toggleRect.bottom <= listRect.top || toggleRect.top >= listRect.bottom) {
    return null;
  }

  const top = Math.max(toggleRect.top, listRect.top);
  const bottomSpace = Math.max(0, viewportHeight - top - 18);

  return {
    top: `${Math.round(top)}px`,
    right: `${Math.round(viewportWidth - toggleRect.left + 10)}px`,
    maxHeight: `${Math.round(bottomSpace)}px`,
  };
}
