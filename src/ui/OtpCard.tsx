import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  OTP_LENGTH,
  normalizeOtp,
  otpError,
  otpInstruction,
  otpTitle,
  resendCooldown,
  resendLabel,
  type OtpPurpose,
} from "../domain/otp";

/**
 * Tela do código de verificação.
 *
 * Substituiu o link do e-mail. O link precisava de um endereço de retorno, e o
 * desktop empacotado vive em `file://` — nenhum provedor de e-mail sabe abrir
 * isso, então a confirmação só se completava pelo site, num navegador
 * diferente do aplicativo onde a pessoa estava.
 *
 * O componente só apresenta: quem confere o código e quem reenvia é quem
 * chama. Assim a mesma tela serve para confirmar cadastro e para recuperar
 * senha, que terminam em lugares diferentes.
 */
export function OtpCard({
  purpose,
  email,
  sentAt,
  busy,
  error,
  logo,
  onVerify,
  onResend,
  onBack,
}: {
  purpose: OtpPurpose;
  email: string;
  /** Instante do último envio, para a contagem do reenvio. */
  sentAt: number;
  busy: boolean;
  error: string;
  logo?: ReactNode;
  onVerify: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState("");
  const [remaining, setRemaining] = useState(() => resendCooldown(sentAt));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    // Recalcula do relógio a cada segundo em vez de decrementar um contador:
    // a aba em segundo plano tem os temporizadores estrangulados, e um
    // decremento cego deixaria a espera parada onde ficou.
    setRemaining(resendCooldown(sentAt));
    const timer = window.setInterval(
      () => setRemaining(resendCooldown(sentAt)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [sentAt]);

  const submit = () => {
    const invalid = otpError(code);
    if (invalid) return setLocalError(invalid);
    setLocalError("");
    onVerify(normalizeOtp(code));
  };

  const shown = localError || error;

  return (
    <main className="auth-screen">
      <section className="auth-card otp-card">
        {logo}
        <span className="eyebrow">LILI · ONLINE</span>
        <h1>{otpTitle(purpose)}</h1>
        <p>{otpInstruction(purpose, email)}</p>

        <label className="otp-field">
          <span>Código</span>
          <input
            ref={inputRef}
            value={code}
            // `inputMode` numérico abre o teclado de números no celular sem
            // recusar a colagem, que `type="number"` estragaria.
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            aria-label={`Código de ${OTP_LENGTH} dígitos`}
            aria-invalid={Boolean(shown)}
            placeholder={"0".repeat(OTP_LENGTH)}
            onChange={(event) => {
              // Limpa na digitação: quem cola do e-mail traz espaço e hífen.
              setCode(normalizeOtp(event.target.value));
              if (localError) setLocalError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        </label>

        {shown && (
          <div className="auth-error" role="alert">
            {shown}
          </div>
        )}

        <button className="primary-button" disabled={busy} onClick={submit}>
          {busy ? "Conferindo…" : "Confirmar"}
        </button>

        <div className="otp-actions">
          <button
            className="auth-inline-action"
            disabled={busy || remaining > 0}
            onClick={onResend}
          >
            {resendLabel(remaining)}
          </button>
          <button className="auth-inline-action" disabled={busy} onClick={onBack}>
            Usar outro e-mail
          </button>
        </div>
      </section>
    </main>
  );
}
