import { useState } from 'react';
import { errorMessage } from '../../lib/api';
import { changeEmail, confirmEmailChange, type OtpChallenge } from '../../lib/auth';
import { toast } from '../../lib/store';
import { OtpStep } from '../AuthForm';
import { Button, Field, Input, Modal } from '../ui';

/** Change the account email. A code goes to the new address; nothing changes until it is entered. */
export function ChangeEmailButton({ current }: { current: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState<OtpChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setOtp(null);
    setEmail('');
    setError(null);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Change email
      </Button>
      <Modal open={open} onClose={close} title="Change email">
        {otp ? (
          <OtpStep
            otp={otp}
            submitLabel="Confirm new email"
            onBack={() => setOtp(null)}
            onVerify={async (code) => {
              await confirmEmailChange(otp, code);
              toast(`Email changed to ${otp.email}`, 'success');
              close();
            }}
          />
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                setOtp(await changeEmail(email));
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {current && <p className="text-sm text-ink-2">Current email: <span className="font-medium text-ink">{current}</span></p>}
            <Field label="New email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" className="h-11" autoFocus />
            </Field>
            {error && (
              <p className="rounded-xl bg-critical/10 px-3 py-2 text-sm text-critical-ink" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="w-full">
              Send code to new email
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}
