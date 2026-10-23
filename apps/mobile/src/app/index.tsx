import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '@/auth/session';
import { useTheme } from '@/lib/theme';

/** Porta de entrada: manda para o login ou para a area do usuario. */
export default function Entry() {
  const t = useTheme();
  const { status } = useSession();
  if (status === 'loading')
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.brand} />
      </View>
    );
  return <Redirect href={status === 'signedOut' ? '/login' : '/resumo'} />;
}
