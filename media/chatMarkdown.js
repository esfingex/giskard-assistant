/**
 * Giskard Assistant VSCode Extension — Célula webview: Pipeline Markdown
 * Copyright (C) 2025-2026 Giskard Project
 *
 * Extraída de chatUtils.js (wave E): alertas GitHub, tags de thinking,
 * preprocesado y render markdown. Scope global compartido (patrón wave 7b) —
 * carga DESPUÉS de chatUtils.js (usa escapeHtml).
 */

const ALERT_LABELS = {
    NOTE: 'Note',
    TIP: 'Tip',
    IMPORTANT: 'Important',
    WARNING: 'Warning',
    CAUTION: 'Caution'
};
const ALERT_ICONS = {
    NOTE: 'ℹ️',
    TIP: '💡',
    IMPORTANT: '💜',
    WARNING: '⚠️',
    CAUTION: '🚨'
};

/**
 * Convierte alertas GitHub (> [!NOTE] ... > lineas ...) en divs markdown-alert.
 * Captura el bloque completo de lineas "<" contiguas y ESCAPA el contenido
 * (escapeHtml) antes de inyectarlo: marcado inline (**bold**, `code`) se
 * preserva, HTML crudo queda como texto literal.
 */
function convertAlerts(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
        if (m) {
            const type = m[1].toUpperCase();
            const cls = 'markdown-alert-' + type.toLowerCase();
            const body = [m[2]];
            // Lineas de continuacion: "> ..." contiguas (formato GitHub real)
            while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) {
                i++;
                body.push(lines[i].replace(/^\s*>\s?/, ''));
            }
            const icon = ALERT_ICONS[type] || '';
            const label = ALERT_LABELS[type] || 'Note';
            out.push(
                '<div class="markdown-alert ' +
                    cls +
                    '"><div class="markdown-alert-title">' +
                    icon +
                    ' ' +
                    label +
                    '</div>' +
                    escapeHtml(body.join('\n')) +
                    '</div>'
            );
        } else {
            out.push(lines[i]);
        }
    }
    return out.join('\n');
}

/**
 * Normaliza variantes de tags de razonamiento (<thinking>, <thought>, y sus
 * formas escapadas) a <think>/</think>, SIN tocar bloques de codigo (fences
 * ``` e inline `). La extraccion del think-box vive en chatView.js.
 */
function normalizeThinkingTags(text) {
    if (!text) return '';
    const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    return parts
        .map((part) => {
            if (!part) return part;
            if (part.startsWith('```') || part.startsWith('`')) return part; // codigo: no tocar
            return part
                .replace(/&lt;think&gt;/g, '<think>')
                .replace(/&lt;\/think&gt;/g, '</think>')
                .replace(/&lt;thinking&gt;/g, '<think>')
                .replace(/&lt;\/thinking&gt;/g, '</think>')
                .replace(/&lt;thought&gt;/g, '<think>')
                .replace(/&lt;\/thought&gt;/g, '</think>')
                .replace(/<thinking>/g, '<think>')
                .replace(/<\/thinking>/g, '</think>')
                .replace(/<thought>/g, '<think>')
                .replace(/<\/thought>/g, '</think>');
        })
        .join('');
}

function preprocessMarkdown(text) {
    if (!text) return '';

    // 1. Ensure space/newline before triple backticks if glued to text (e.g. "mejora:```typescript")
    let fixedText = text.replace(/([^\n`])```/g, '$1\n```');

    // 2. Auto-fix un-backticked code patterns like "typescript// relative/path..."
    fixedText = fixedText.replace(
        /([a-zA-Z0-9_-]+)\s*(\/\/\s*[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+)\s*(import|export|const|let|var|class|function|type|interface)/g,
        '\n```$1\n$2\n$3'
    );

    const parts = fixedText.split(/(```[\s\S]*?```)/g);
    return parts
        .map((part) => {
            if (part.startsWith('```')) {
                let codeContent = part;
                // 3. Split concatenated statements without newlines (e.g. ";import", ";export", ";const")
                codeContent = codeContent
                    .replace(/(```[a-zA-Z0-9_-]+)(\/\/|\/\*)/i, '$1\n$2')
                    .replace(/;import\b/g, ';\nimport')
                    .replace(/;export\b/g, ';\nexport')
                    .replace(/;const\b/g, ';\nconst')
                    .replace(/;let\b/g, ';\nlet')
                    .replace(/;var\b/g, ';\nvar')
                    .replace(/;type\b/g, ';\ntype')
                    .replace(/;interface\b/g, ';\ninterface')
                    .replace(/;class\b/g, ';\nclass')
                    .replace(/;function\b/g, ';\nfunction');

                // 4. Format dense single-line code blocks
                if ((codeContent.match(/;/g) || []).length > 2 && codeContent.split('\n').length < 5) {
                    codeContent = codeContent
                        .replace(
                            /;\s*(import|export|const|let|var|class|function|type|interface|private|public|protected|return|if|try|catch)/g,
                            ';\n$1'
                        )
                        .replace(/;\s*/g, ';\n')
                        .replace(/\{\s*/g, ' {\n')
                        .replace(/\}\s*/g, '}\n');
                }
                return codeContent;
            }

            let clean = part;
            clean = clean.replace(/([^\n])(\s*##+\s)/g, '$1\n\n$2');
            clean = clean.replace(/([:\.\wáéíóúñA-Z])\s*(\d+\.\s+[\*\*\wáéíóúñA-Z])/g, '$1\n$2');
            clean = clean.replace(/([^\n])(\d+\.\s+[\*\*\wáéíóúñA-Z])/g, '$1\n$2');
            clean = clean.replace(/([^\n])(-\s+[\*\*\wáéíóúñA-Z✔️✅❌💡▶])/g, '$1\n$2');

            // GitHub Markdown Alerts: bloque completo de lineas ">" contiguas, contenido escapado
            clean = convertAlerts(clean);

            if (clean.includes('├──') || clean.includes('└──')) {
                clean = clean.replace(/((?:^[ \t]*(?:├──|└──|│|\/)[^\n]*\n?)+)/gm, '\n```text\n$1```\n');
            }
            return clean;
        })
        .join('');
}

function formatMarkdown(text) {
    if (!text) return '';

    // 1. Universal Stream Sanitizer: Close unclosed code blocks if response ended mid-stream
    let sanitized = text;
    const fenceMatches = (sanitized.match(/```/g) || []).length;
    if (fenceMatches % 2 !== 0) {
        sanitized += '\n```';
    }

    const preprocessed = preprocessMarkdown(sanitized);
    let htmlText = preprocessed;

    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
        try {
            if (typeof marked.setOptions === 'function') {
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    highlight: function (code, lang) {
                        if (typeof hljs !== 'undefined') {
                            if (lang && hljs.getLanguage && hljs.getLanguage(lang)) {
                                return hljs.highlight(code, { language: lang }).value;
                            }
                            return hljs.highlightAuto(code).value;
                        }
                        return code;
                    }
                });
            }
            htmlText = marked.parse(preprocessed);
        } catch (e) {
            console.error('Markdown error:', e);
            htmlText = escapeHtml(preprocessed);
        }
    } else {
        htmlText = escapeHtml(preprocessed);
    }
    return htmlText;
}
