import mermaid from 'mermaid';

export async function renderDiagram(source, id, dark) {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', suppressErrorRendering: true });
  const { svg } = await mermaid.render(id, source);
  return svg;
}
