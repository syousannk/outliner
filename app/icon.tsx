import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  const rows = [8, 16, 24];
  return new ImageResponse(
    (
      <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 26 }}>
          {rows.map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#374151', flexShrink: 0 }} />
              <div style={{ flex: 1, height: 1, backgroundColor: '#9ca3af' }} />
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
