import QRCode from "qrcode";
import { config } from "../config";

export function captureUrlForToken(token: string): string {
  return `${config.publicBaseUrl}/verify/${token}`;
}

export async function generateQrPngBase64(url: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
  });
  // dataUrl looks like "data:image/png;base64,...."
  return dataUrl.split(",")[1];
}
