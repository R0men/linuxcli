import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const alt = 'LinuxCLI — a real Linux terminal in your browser';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#0d0f14',
          color: '#e6e6e0',
          padding: '80px',
        }}
      >
        <div style={{ display: 'flex', color: '#3ddc97', fontSize: 32, marginBottom: 24 }}>$ linuxcli</div>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 700 }}>LinuxCLI</div>
        <div style={{ display: 'flex', fontSize: 30, color: '#9a9a92', marginTop: 24, maxWidth: 900 }}>
          A real Linux terminal in your browser — no install, no signup.
        </div>
      </div>
    ),
    { ...size }
  );
}
