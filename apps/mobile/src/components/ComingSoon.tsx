import { Empty, PageHeader, Screen } from './ui';

/** Pagina do site que ainda nao foi convertida para o app (fase "paridade com o site"). */
export function ComingSoon({ title, what }: { title: string; what: string }) {
  return (
    <Screen>
      <PageHeader title={title} />
      <Empty title="Chegando no app" text={`${what} Enquanto isso, esta página funciona completa no site.`} />
    </Screen>
  );
}
