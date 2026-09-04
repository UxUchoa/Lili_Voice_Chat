import { Fragment, type ReactNode } from "react";
import { normalizeReleaseNotes } from "../domain/releaseNotes";
import { IconX } from "./icons";
import { ModalPortal } from "./ModalPortal";

/**
 * As notas da versão, dentro do aplicativo — item pedido depois da 0.1.6.
 *
 * O texto é o corpo da release no GitHub, que por sua vez sai de
 * `docs/CHANGELOG.md`: uma fonte só para o que mudou, escrita uma vez e lida
 * nos dois lugares. Quem usa o aplicativo instalado não tinha como saber o que
 * vinha na atualização — o aviso dizia só "versão nova pronta".
 *
 * O renderizador entende o pouco de Markdown que essas notas usam: título de
 * seção, item de lista, negrito e código. Não é um renderizador de Markdown de
 * verdade nem quer ser — o texto vem do nosso próprio repositório, e trazer uma
 * biblioteca inteira para quatro marcações seria peso morto no pacote. Nada
 * disso passa por `dangerouslySetInnerHTML`: cada pedaço vira nó de React.
 *
 * O que chega aqui nem sempre é Markdown, e essa era a origem de um defeito
 * visível: no aplicativo instalado as notas vêm do feed Atom do GitHub, onde o
 * corpo da release já está convertido em HTML. O painel recebia `<h3>`, `<li>`
 * e `<strong>`, não reconhecia nenhum e desenhava as etiquetas como texto —
 * uma parede de HTML cru no lugar das novidades. `normalizeReleaseNotes`
 * traduz esse HTML de volta para o Markdown que este arquivo já lê, então
 * daqui para baixo continua existindo um formato só.
 */

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    if (piece.startsWith("**") && piece.endsWith("**"))
      return <strong key={key}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`"))
      return <code key={key}>{piece.slice(1, -1)}</code>;
    return <Fragment key={key}>{piece}</Fragment>;
  });
}

export function ReleaseNotes({ notes }: { notes: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`l${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{inline(item, `l${blocks.length}-${index}`)}</li>
        ))}
      </ul>,
    );
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    // As linhas de um parágrafo vêm quebradas em 80 colunas no changelog; aqui
    // elas voltam a ser uma só, para quebrar na largura do painel.
    const text = paragraph.join(" ");
    paragraph = [];
    blocks.push(<p key={`p${blocks.length}`}>{inline(text, `p${blocks.length}`)}</p>);
  };

  for (const raw of normalizeReleaseNotes(notes).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(<h4 key={`h${blocks.length}`}>{inline(heading[2], `h${blocks.length}`)}</h4>);
      continue;
    }
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    // Continuação de um item: o changelog quebra os itens longos em várias
    // linhas indentadas, e emendá-las ao item evita uma lista de fragmentos.
    if (list.length && /^\s/.test(raw)) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return <div className="release-notes">{blocks}</div>;
}

/**
 * O que mudou, e o que fazer a respeito.
 *
 * As ações são de quem chama: baixar, reiniciar e instalar, ou abrir a página
 * da release. Este componente não conhece o `electron-updater` — ele mostra o
 * texto e os botões que recebe.
 *
 * ---
 *
 * Duas coisas que não eram de estilo, mas pareciam:
 *
 * O X ficava embaixo do aviso amarelo de atualização. Não é coincidência: as
 * duas telas falam da mesma atualização e aparecem juntas por definição. O
 * aviso é `position: fixed` e passa por cima de tudo, então quem tinha que
 * sair da frente era este painel — daí o `release-notes-backdrop`, que reserva
 * a faixa do aviso antes de centralizar o resto.
 *
 * E "Abrir a página da release" era um `<a>` cru dentro de um rodapé de
 * botões. Num tema escuro, um link cinza ao lado de um botão vermelho não
 * parece uma alternativa: parece uma nota de rodapé. É a saída de quem está
 * com o atualizador quebrado, ou seja exatamente de quem não pode contar com o
 * botão de cima — a ação que menos podia parecer decorativa era a que mais
 * parecia. Vira botão secundário de verdade; a hierarquia continua clara
 * porque só um dos dois é preenchido.
 */
export function ReleaseNotesModal({
  version,
  notes,
  releaseUrl,
  actions,
  onClose,
}: {
  version: string;
  notes?: string;
  releaseUrl?: string;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <ModalPortal>
      <div
        className="modal-backdrop release-notes-backdrop"
        onClick={onClose}
      >
        <section
          className="release-notes-panel"
          role="dialog"
          aria-label={`Novidades da versão ${version}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="close-settings" aria-label="Fechar" onClick={onClose}>
            <IconX size={18} />
          </button>
          <span className="eyebrow">NOVIDADES</span>
          <h2>Versão {version}</h2>
          {notes ? (
            <ReleaseNotes notes={notes} />
          ) : (
            <p className="empty-copy">
              Esta versão foi publicada sem notas.
              {releaseUrl ? " A página da release tem os arquivos." : ""}
            </p>
          )}
          <footer className="release-notes-actions">
            {actions}
            {releaseUrl && (
              <a
                className="outline-button"
                href={releaseUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir a página da release
              </a>
            )}
          </footer>
        </section>
      </div>
    </ModalPortal>
  );
}
