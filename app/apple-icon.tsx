import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white', borderRadius: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26, width: 120 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#374151', flexShrink: 0 }} />
              <div style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: '#9ca3af' }} />
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
