// Endereço da API deste ambiente, SEM barra no fim.
//
// Vazio = modo demonstração (o app funciona, mas guarda tudo só no aparelho).
// Em localhost este arquivo é ignorado: lá a API é sempre http://localhost:3000.
//
// SUBDOMÍNIO DO MESMO DOMÍNIO, e não o endereço que o Render dá de origem.
// Não é estética: o app está em saldonline.com.br, e com a API em
// *.onrender.com o navegador trata o cookie de sessão como cookie de
// TERCEIRO — que o Safari bloqueia por padrão e o Chrome vem restringindo.
// Resultado medido: recarregar a página voltava para a tela de login, porque
// o POST /auth/refresh saía sem o cookie e a API respondia 401.
//
// Sob o mesmo domínio registrável os dois são o MESMO site, o cookie volta a
// ser de primeira parte e deixa de depender de política de terceiros. É o que
// permite COOKIE_SAMESITE=strict no servidor (ver src/auth/session-cookie.ts).
window.GF_API_URL = "https://api.saldonline.com.br";

// O numero de WhatsApp da API, so digitos com DDI: "5531988887777".
//
// Vazio = a conexao com o WhatsApp nem aparece no app. E de proposito: sem
// numero nao ha para onde mandar o codigo, e uma tela que promete o que nao
// existe e pior do que uma tela a menos. Preenchido aqui, a opcao nasce no
// menu do perfil sem precisar de outro deploy da API.
window.GF_WHATSAPP_NUMERO = "";
