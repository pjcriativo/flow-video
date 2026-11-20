/**
 * The wording of each plan card. The server sends it in English next to the numbers, so the
 * browser swaps it by plan id when the language is Portuguese. Numbers always come from the server.
 */
export const ptPlanText: Record<string, { tagline: string; features: string[]; highlight: string | null }> = {
  free: {
    tagline: "Experimente todos os estúdios no seu ritmo.",
    features: ["Créditos de boas-vindas no cadastro", "Todos os estúdios de imagem, vídeo e áudio", "Biblioteca privada", "Uso pessoal"],
    highlight: null,
  },
  plus: {
    tagline: "Para criar toda semana.",
    features: ["Créditos novos todo mês", "Mais gerações ao mesmo tempo", "Uso comercial", "Recarregue quando quiser"],
    highlight: null,
  },
  pro: {
    tagline: "Para quem cria todo dia.",
    features: ["Três vezes os créditos do Plus", "Fila mais rápida, com mais gerações ao mesmo tempo", "Uso comercial", "Acesso antecipado a novos modelos"],
    highlight: "Mais escolhido",
  },
  studio: {
    tagline: "Para vídeo pesado e trabalhos em lote.",
    features: ["O maior pacote mensal de créditos", "O máximo de gerações ao mesmo tempo", "Uso comercial", "Acesso antecipado a novos modelos e ferramentas"],
    highlight: "Melhor custo por crédito",
  },
};
