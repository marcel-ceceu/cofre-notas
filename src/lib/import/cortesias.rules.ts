/**
 * Lista default de cortesias (porta de 2606-RegexRegrasConversas.txt).
 * Frases cruas; a normalização (minúsculas/sem acento/sem pontuação) é feita em
 * prepareCortesias(). Editável: dá para expor isso nas preferências no futuro.
 */
export const DEFAULT_CORTESIAS: string[] = [
  // saudações
  "oi", "ola", "opa", "eai", "e ai", "fala", "fala ai", "salve",
  "bom dia", "boa tarde", "boa noite",
  // bem-estar / como vai
  "tudo bem", "tudo certo", "tudo joia", "tudo tranquilo", "tudo otimo",
  "como vai", "como voce esta", "como esta", "beleza", "blz",
  "espero que esteja bem", "espero que voce esteja bem",
  // agradecimentos
  "obrigado", "obrigada", "muito obrigado", "obg", "valeu", "vlw",
  "agradeco", "grato", "agradecido", "de nada", "imagina", "disponha",
  // confirmações / interjeições
  "ok", "okay", "certo", "certissimo", "isso", "isso mesmo", "exato",
  "exatamente", "perfeito", "otimo", "excelente", "maravilha", "show",
  "show de bola", "massa", "boa", "boa pergunta", "otima pergunta",
  "entendi", "entendido", "captei", "captou", "faz sentido", "com certeza",
  "claro", "claro que posso", "fechado", "pronto", "beleza entao",
  "vamos la", "bora", "segue", "pode ser", "tranquilo",
  "sem problema", "sem problemas",
  // aberturas típicas do Claude
  "como posso ajudar", "como posso te ajudar", "em que posso ajudar",
  "posso ajudar", "fico feliz em ajudar", "fico a disposicao",
  "estou a disposicao", "deixa eu", "deixa eu ver", "boa ideia",
  // fechos / despedidas
  "abraco", "abracos", "abs", "ate mais", "ate logo", "falou",
  "qualquer coisa estou aqui", "qualquer duvida me chama",
  "espero ter ajudado", "conte comigo",
  // inglês
  "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
  "how are you", "hows it going", "thanks", "thank you", "thank you so much",
  "thanks a lot", "got it", "sure", "of course", "great", "perfect",
  "awesome", "nice", "no problem", "youre welcome", "you are welcome",
  "cheers", "best regards", "regards", "glad to help", "happy to help",
  "let me know if",
];
