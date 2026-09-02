import { redirect } from 'next/navigation';

// design/0-shell.html opens on the brief, so the bare host does too
export default function Root() {
  redirect('/brief');
}
