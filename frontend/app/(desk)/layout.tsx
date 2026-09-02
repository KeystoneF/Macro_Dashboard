import type { ReactNode } from 'react';
import { COLOR } from '../theme';
import SessionGate from '../components/SessionGate';
import Sidebar from './Sidebar';

export default function DeskLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <div style={{ display: 'flex', height: '100vh', background: COLOR.bg }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>{children}</div>
      </div>
    </SessionGate>
  );
}
