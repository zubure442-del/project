import { StyleSheet, Text, View } from 'react-native';

export default function TodayScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Vuelo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0B0F' },
  title: { color: '#FFFFFF', fontSize: 48, fontWeight: '200' },
});
