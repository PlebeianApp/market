import { Store } from '@tanstack/store';

interface ConfigState {
  config: {
    appRelay?: string;
    appSettings?: any;
    appPublicKey?: string;
    needsSetup?: boolean;
    [key: string]: any;
  };
  isLoaded: boolean;
}

const initialState: ConfigState = {
  config: {},
  isLoaded: false,
}

export const configStore = new Store<ConfigState>(initialState)

export const configActions = {
  setConfig: (config: any) => {
    configStore.setState((state) => ({
      ...state,
      config,
      isLoaded: true,
    }))
    return config
  },
  
  getAppRelay: () => {
    return configStore.state.config.appRelay
  },
  
  getAppPublicKey: () => {
    return configStore.state.config.appPublicKey
  },
  
  getAppSettings: () => {
    return configStore.state.config.appSettings
  },
  
  needsSetup: () => {
    return configStore.state.config.needsSetup
  },
  
  isConfigLoaded: () => {
    return configStore.state.isLoaded
  }
}

// React hook for consuming the store
export const useConfig = () => {
  return {
    ...configStore.state,
    ...configActions,
  }
} 