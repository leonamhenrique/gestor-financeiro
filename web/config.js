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
