import { Alert } from 'react-native';

export function confirmAction(title: string, message: string, confirmText = 'Continue'): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: 'default', onPress: () => resolve(true) },
    ]);
  });
}

export default confirmAction;
