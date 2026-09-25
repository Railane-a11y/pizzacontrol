# PizzaControl — Estado atual (setembro/2026)

## Como o sistema funciona agora
- Venda pela **Cakto** (pagamento único, acesso vitalício):
  - Básico R$ 9,90 — https://pay.cakto.com.br/8rdpouv_1139386
  - PRO R$ 19,90 — https://pay.cakto.com.br/3dsh6k4_1139407
  - Upgrade PRO R$ 15,00 — https://pay.cakto.com.br/wx9esqb_1139423 (botão de upgrade dentro do app)
- A Cakto avisa o cenário **"PizzaControl - Vendas Cakto"** no Make, que cria o login,
  grava `email` + `plano` ("basico" ou "pro") no Firestore e envia o e-mail para o
  cliente criar a senha.
- Reembolso/chargeback do Básico ou PRO apaga o acesso. Reembolso do Upgrade volta para Básico.
- O app lê só o campo `plano`. Não existe mais data de vencimento.

## Plano Básico
Dashboard, Insumos, Fichas, Criar Ficha, Configurações.

## Plano PRO
Tudo do Básico + Massa, Custos Fixos, Bebidas, Gerar Preço e Backup.

## Pendências
- [ ] Testar compra do Básico, do Upgrade e reembolso.
- [ ] SÓ DEPOIS dos testes: publicar `firestore.rules` no Firebase Console
      (Firestore Database → Regras → Publicar) e desligar o cenário antigo do GG Checkout.
- [ ] Traduzir o e-mail de redefinição de senha (Firebase → Authentication → Templates).
- [ ] Criar páginas de Política de Privacidade e Termos de Uso (links do rodapé apontam para "#").
