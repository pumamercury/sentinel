import type { Metadata } from 'next';
import './globals.css';
import { AccountGate } from '../components/account-gate';
export const metadata: Metadata = {
  title: 'Sentinel — Local bug tracker',
  description: 'Your local workspace for tracking bugs and documenting fixes.',
  icons: {
    icon: { url: '/favicon.svg?v=sentinel-robot-1', type: 'image/svg+xml' },
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AccountGate>{children}</AccountGate>
      </body>
    </html>
  );
}
