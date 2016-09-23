In case I forget, installation steps on a new windows box, in a powershell prompt:

###Install Chocolatey
```
iwr https://chocolatey.org/install.ps1 -UseBasicParsing | iex
```

###Install ruby
```
choco install ruby -y
```

###Refresh the environment
```
refreshenv
```

###Bundle install - not sure if this is necessary
```
bundle install
```

###Serving the site
```
bundle exec jekyll s
```
