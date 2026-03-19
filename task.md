https://github.com/PlebeianApp/market/issues/642

context vm server --> get currency. 

Hardcoded backend API. Would be nice to do the same with a context VM instead. Use the existing app relays (nak for development, relay.staging.market, production relay exists too).

Would be nice if it works in the development environment too.

Have a look at wave funk: https://github.com/zeSchlausKwab/earthly/tree/master/contextvm

Its fine if it works locally.. 

Currently we are caching the BTC price in the frontend. Does it make sense to cache it or should we load it every time? We also have the state in the relay. Perhaps ask Gzuuus what he thinks..

  ┃                                                                                                             ┃                                     ▄                                                                       █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█                                                                       █  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀                                                                       ▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀                                                                                   tab agents  ctrl+p commands    Session   Running ansible deploy playbook                                                                   
  Continue  opencode -s ses_2fa146099ffebiOflojw0gs7ch

c03rad0r@c03rad0r-DQ05proplus:~/market$ 


