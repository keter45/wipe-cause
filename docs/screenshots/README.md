# Capturas dos READMEs

Atualizadas em 21/10/2026 a partir do app local. Os exemplos usam nomes fictícios e a mesma luta do The Coiled Altar nos dois idiomas.

| Arquivo em `pt/` e `en/` | O que mostra |
| --- | --- |
| `replay-overview.webp` | Arena, movimentação, fantasmas, medidor, frames da raid e controles. |
| `replay-timeline.webp` | Linha do tempo com as faixas de mecânicas abertas. |
| `replay.webp` | Clipe animado de dez segundos, focado em Kaelis. |
| `pull.webp` | Diagnóstico e gatilho do wipe. |
| `death.webp` | Morte com dano, cura e debuffs. |
| `mechanics.webp` | Falha de mecânica com os envolvidos e orientação. |
| `boss.webp` | Resumo das tentativas do boss. |
| `metrics.webp` | Evolução de mecânicas entre pulls. |
| `solo.webp` | Análise individual e prioridades. |
| `share.webp` | Cartão exportado pelo componente de compartilhamento. |

## Como renovar

1. Use um report e um fight da mesma tentativa: confira o `startMs`. Prepare uma cópia com nomes fictícios e sem caminhos pessoais antes de capturar.
2. Abra os dados no app atual e capture cada cenário em português e inglês. Use os controles reais para selecionar o player, navegar no tempo, abrir as faixas e ajustar a câmera.
3. Capture a interface sem alterar seu layout para a imagem. Exporte o cartão pelo renderizador do app e o clipe pelo exportador de replay, em vez de recriá-los manualmente.
4. Na versão web, o clipe pode omitir a imagem remota de fundo da arena; esse é o comportamento atual do exportador. As capturas estáticas mostram o fundo carregado na interface.
5. Grave as capturas estáticas em WebP e preserve a animação de `replay.webp`. Atualize texto e alt text quando mudar o cenário.
6. Confira os dois READMEs renderizados, os caminhos locais, o enquadramento das imagens e a reprodução dos clipes. Mantenha dados e páginas temporárias de captura fora do Git.
