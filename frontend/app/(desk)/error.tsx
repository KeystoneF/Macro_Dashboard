'use client';

import Link from 'next/link';
import * as T from '../theme';

export default function DeskError({ retry }: { retry: () => void }) {
  return (
    <main className="desk-page" style={T.page}>
      <h1 style={T.wordmark}>This page could not load</h1>
      <p style={{ margin: '16px 0' }} role="alert">Please try again. You can also return to the daily brief.</p>
      <button style={T.control} onClick={retry}>Try again</button>
      <Link href="/brief" style={{ ...T.control, marginLeft: 12 }}>Daily brief</Link>
    </main>
  );
}
