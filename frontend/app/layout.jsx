import './globals.css';

export const metadata = {
  title: 'SkyTrace — NASA Eyes on SPHEREx & Planet X',
  description: 'Interactive 3D Solar System Ephemeris & SPHEREx 102-Band Multi-Epoch Sky Comparator'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
