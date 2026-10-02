import { redirect } from 'next/navigation';

// The sign-in experience is the full auth modal (buyer / developer / channel
// partner / admin) rendered on the home page. This clean, shareable URL simply
// opens it via the ?signin=1 deep-link that landing.js already handles.
export default function SignInRedirect() {
  redirect('/?signin=1');
}
