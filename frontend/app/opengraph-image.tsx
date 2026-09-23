import { ImageResponse } from "next/og";

// The picture Telegram, WhatsApp and Google show for a link to onomika.
// Rendered at build time by next/og — no binary asset to keep in sync with the brand.
export const runtime = "edge";
export const alt = "Onomika — подготовка к HSK";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "88px 96px",
          background: "linear-gradient(160deg, #3f5a4a 0%, #7c9885 100%)",
          color: "#f4f1ec",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 40, opacity: 0.85 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "#f4f1ec",
              color: "#3f5a4a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            O
          </div>
          <span>Onomika</span>
        </div>
        <div style={{ fontSize: 86, fontWeight: 700, lineHeight: 1.1, marginTop: 44 }}>
          Подготовка к HSK
        </div>
        <div style={{ fontSize: 40, lineHeight: 1.35, marginTop: 28, opacity: 0.9 }}>
          Списки HSK и слова из учебника — карточки, повторения и оценка готовности.
        </div>
      </div>
    ),
    size,
  );
}
