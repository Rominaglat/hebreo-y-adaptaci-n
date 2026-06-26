// How a lesson's attached file should be previewed in the browser.
//   pdf    → render natively in an <iframe> (browsers ship a PDF viewer;
//            far more reliable than the deprecated Google Docs Viewer embed
//            that used to leave students staring at a blank frame).
//   image  → render with <img>.
//   office → needs an external viewer (Office Online) to render inline.
//   other  → unknown/binary: offer open-in-tab + download only.
export type FilePreviewKind = 'pdf' | 'image' | 'office' | 'other';

export function getFilePreviewKind(url: string): FilePreviewKind {
  if (!url) return 'other';
  // Strip query string and hash so signed-URL params / #view fragments
  // don't hide the real extension.
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  if (clean.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(clean)) return 'image';
  if (/\.(docx?|pptx?|xlsx?|odt|ods|odp)$/.test(clean)) return 'office';
  return 'other';
}
