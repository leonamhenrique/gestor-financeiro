// ============================================================
// scripts/rls.js
// ============================================================
// Prova que as politicas de RLS valem, e para QUEM elas valem.
//
//   node scripts/rls.js        (precisa de direito de criar papel no banco)
//
// A armadilha que este script existe para nao deixar repetir: SUPERUSUARIO
// do Postgres ignora RLS, mesmo com FORCE. A primeira versao deste teste
// rodou como `postgres`, mostrou tudo vazando, e nao provava nada -- nem que
// estava errado, nem que estava certo.
//
// Por isso ele cria dois papeis comuns e testa os dois casos:
//
//   gf_dono  dona da tabela, como o papel do Neon na producao. E o caso que
//            o FORCE existe para cobrir: sem FORCE, dono ignora politica.
//   gf_app   sem posse nenhuma. Cai nas politicas ate sem FORCE.
//
// Se algum dia a producao passar a conectar como superusuario, o RLS vira
// enfeite silencioso -- e e este script que percebe.
// ============================================================
const { PrismaClient } = require('@prisma/client');
const raiz = new PrismaClient();

const url = (papel) =>
  `postgresql://${papel}:${papel}@localhost:5432/gestor_financeiro?schema=public`;

const comoPapel = (papel) => new PrismaClient({ datasources: { db: { url: url(papel) } } });

async function preparar() {
  for (const papel of ['gf_dono', 'gf_app']) {
    await raiz.$executeRawUnsafe(`DROP OWNED BY ${papel} CASCADE`).catch(() => {});
    await raiz.$executeRawUnsafe(`DROP ROLE IF EXISTS ${papel}`).catch(() => {});
    await raiz.$executeRawUnsafe(`CREATE ROLE ${papel} LOGIN PASSWORD '${papel}'`);
    await raiz.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${papel}`);
  }
  // Uma tabela de brinquedo, dona = gf_dono, com as MESMAS regras da migration.
  await raiz.$executeRawUnsafe(`DROP TABLE IF EXISTS cofre`);
  await raiz.$executeRawUnsafe(`CREATE TABLE cofre (id text PRIMARY KEY, user_id text NOT NULL, segredo text)`);
  await raiz.$executeRawUnsafe(`ALTER TABLE cofre OWNER TO gf_dono`);
  await raiz.$executeRawUnsafe(`ALTER TABLE cofre ENABLE ROW LEVEL SECURITY`);
  await raiz.$executeRawUnsafe(`ALTER TABLE cofre FORCE ROW LEVEL SECURITY`);
  await raiz.$executeRawUnsafe(
    `CREATE POLICY dono_cofre ON cofre USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual())`,
  );
  await raiz.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON cofre TO gf_app`);
  await raiz.$executeRawUnsafe(`GRANT EXECUTE ON FUNCTION dono_atual() TO gf_dono, gf_app`);
}

const comDono = (cliente, id, sql) =>
  cliente.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${id}, true)`;
    return sql(tx);
  });

async function testar(papel) {
  const c = comoPapel(papel);
  console.log(`\n=== conectado como ${papel} ===`);

  await comDono(c, 'alice', (tx) =>
    tx.$executeRawUnsafe(`INSERT INTO cofre VALUES ('a1','alice','diario da alice')`),
  );
  await comDono(c, 'bruno', (tx) =>
    tx.$executeRawUnsafe(`INSERT INTO cofre VALUES ('b1','bruno','notas do bruno')`),
  );

  const veAlice = await comDono(c, 'alice', (tx) => tx.$queryRawUnsafe(`SELECT segredo FROM cofre`));
  console.log(`  alice enxerga: ${JSON.stringify(veAlice.map((r) => r.segredo))}`);

  const semDono = await c.$queryRawUnsafe(`SELECT segredo FROM cofre`);
  console.log(
    `  sem dono no contexto: ${JSON.stringify(semDono.map((r) => r.segredo))}` +
      (semDono.length === 0 ? '  -> nada, falha fechada' : '  *** VAZOU ***'),
  );

  let gravouNoNomeAlheio = false;
  try {
    await comDono(c, 'bruno', (tx) =>
      tx.$executeRawUnsafe(`INSERT INTO cofre VALUES ('x1','alice','invadido')`),
    );
    gravouNoNomeAlheio = true;
  } catch (e) {
    /* recusado */
  }
  console.log(
    `  bruno grava no nome da alice: ${gravouNoNomeAlheio ? '*** CONSEGUIU ***' : 'recusado pelo banco'}`,
  );

  const apagou = await comDono(c, 'bruno', (tx) =>
    tx.$executeRawUnsafe(`DELETE FROM cofre WHERE id = 'a1'`),
  );
  console.log(`  bruno apaga a linha da alice: ${apagou} linha(s)` + (apagou === 0 ? '  -> nenhuma' : '  *** APAGOU ***'));

  await raiz.$executeRawUnsafe(`DELETE FROM cofre`);
  await c.$disconnect();
}

(async () => {
  await preparar();
  await testar('gf_dono'); // o caso da producao: dona da tabela, sem superpoder
  await testar('gf_app'); // papel comum, sem posse
  await raiz.$executeRawUnsafe(`DROP TABLE IF EXISTS cofre`);
  for (const papel of ['gf_dono', 'gf_app']) {
    await raiz.$executeRawUnsafe(`DROP OWNED BY ${papel} CASCADE`).catch(() => {});
    await raiz.$executeRawUnsafe(`DROP ROLE IF EXISTS ${papel}`).catch(() => {});
  }
  await raiz.$disconnect();
})().catch((e) => {
  console.log('ERRO: ' + String(e.message).slice(0, 500));
  process.exit(1);
});
