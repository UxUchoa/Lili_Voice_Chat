import type { CSSProperties, ReactNode } from "react";
import type { Profile } from "../domain/types";

/** Rótulo da presença, do jeito que os outros leem. */
export function statusLabel(status: Profile["status"]): string {
  return status === "online"
    ? "Online"
    : status === "idle"
      ? "Ausente"
      : status === "dnd"
        ? "Não perturbe"
        : "Offline";
}

/**
 * A parte visível de um perfil: banner, avatar, identidade e bio.
 *
 * Mora fora do modal porque a mesma peça aparece em dois lugares — o cartão de
 * outra pessoa e a prévia do próprio perfil nas configurações (item 24). Eram
 * duas marcações diferentes, então o que a pessoa via ao se editar não era o
 * que os outros viam de fato; qualquer ajuste em um lado passava batido no
 * outro.
 *
 * Só apresenta. Ações, apelido e nota entram por `children`, que são coisas de
 * quem olha e não do perfil em si — não fazem sentido na própria prévia.
 */
export function ProfileCard({
  profile,
  nickname,
  children,
}: {
  profile: Profile;
  /** Apelido dado por quem está vendo; vazio na prévia do próprio perfil. */
  nickname?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <div
        className="user-profile-banner"
        style={
          {
            "--profile-color": profile.color,
            ...(profile.bannerUrl
              ? { backgroundImage: `url(${profile.bannerUrl})` }
              : {}),
          } as CSSProperties
        }
      />
      <div className="user-profile-avatar">
        <span
          className="avatar avatar-xl"
          style={{ "--avatar-color": profile.color } as CSSProperties}
        >
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" />
          ) : (
            <span>{profile.avatar}</span>
          )}
          <i className={`presence ${profile.status}`} />
        </span>
      </div>

      <div className="user-profile-body">
        <div className="user-profile-identity">
          <h2>{nickname || profile.displayName}</h2>
          <span>@{profile.username}</span>
          {nickname && (
            <small>Também conhecido como {profile.displayName}</small>
          )}
          {profile.pronouns && <small>{profile.pronouns}</small>}
          <span className="user-profile-status">
            <i className={`presence ${profile.status}`} />
            {statusLabel(profile.status)}
            {profile.customStatus ? ` · ${profile.customStatus}` : ""}
          </span>
        </div>

        {profile.bio && (
          <div className="user-profile-section">
            <span className="eyebrow">SOBRE MIM</span>
            <p>{profile.bio}</p>
          </div>
        )}

        {children}
      </div>
    </>
  );
}
