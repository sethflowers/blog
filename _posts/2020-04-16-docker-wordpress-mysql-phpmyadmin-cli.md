---
layout: post
title: Docker Compose on Windows for WordPress, MySQL, phpMyAdmin, and WordPress CLI
date: 2019-02-11
comments: false
categories: [Docker, Docker-Compose, WordPress, MySQL, phpMyAdmin, WordPress CLI]
---

Docker Compose can be used to quickly pull up the following:

* A container exposing a WordPress site reachable at http://localhost on port 80
* A container running MySql as the DB for WordPress
* A container exposing a phpMyAdmin site for inspecting the MySql container reachable at http://localhost:42333
* A container running a WordPress CLI to configure the WordPress install in various ways (setting theme, creating users, importing data, etc)

On top of this, the WordPress container runs a custom Shell script which can be used to configured the OS. For instance, I needed libxrender1 to be installed, so my shell script looked like the following:

{% highlight sh %}

  apt-get update && apt-get install libxrender1

  # execute apache
  exec "apache2-foreground"
  
{% endhighlight %}

The following sample docker-compose.yml file shows how this can be done:

{% highlight yml %}

  version: '3.7'

  services:
    db:
      image: mysql:5.7
      volumes:
        - db_data:/var/lib/mysql
      restart: always
      env_file: .env
      environment:
        MYSQL_DATABASE: SomeDatabaseName
      ports:
        - 42333:3306

    wordpress:
      working_dir: /var/www/html
      command:
        - apache2-custom.sh
      volumes:
        - "./wp-init.sh:/usr/local/bin/apache2-custom.sh" # share this shell script, which is executed by the COMMAND directive.
        - wp_data:/var/www/html
        - type: bind
          source: .\html\wp-content
          target: /var/www/html/wp-content
        - type: bind
          source: .\setup\
          target: /var/www/html/wp-content/uploads/setup
      depends_on:
        - db
      image: wordpress:latest
      ports:
        - '80:80'
      restart: always
      env_file: .env
      environment:
        WORDPRESS_DB_HOST: db:3306
        WORDPRESS_DB_USER: $MYSQL_USER
        WORDPRESS_DB_PASSWORD: $MYSQL_PASSWORD
        WORDPRESS_DB_NAME: SomeDatabaseName
        WORDPRESS_TABLE_PREFIX: SomeTablePrefix_
        WORDPRESS_DEBUG: 1
        WORDPRESS_CONFIG_EXTRA: |
            define('WP_POST_REVISIONS', '15');
            define('MEDIA_TRASH', true);
            define('EMPTY_TRASH_DAYS', '10');
            define('DISALLOW_FILE_EDIT', true);
            define('WP_DEBUG_LOG', true);
            define('WP_DEBUG_DISPLAY', false);

    phpmyadmin:
      image: phpmyadmin/phpmyadmin
      ports:
        - 22222:80

    wordpress-cli:
      depends_on:
          - db
          - wordpress
      image: wordpress:cli
        # vstm: This is required to run wordpress-cli with the same
        # user-id as wordpress. This way there are no permission problems
        # when running the cli
      user: xfs
      command: >
          /bin/sh -c '
          sleep 30;
          wp core install --path="/var/www/html" --url="http://localhost" --title="Some Title" --admin_user=$WORDPRESS_ADMIN_USER --admin_password=$WORDPRESS_ADMIN_PASS --admin_email=foo@bar.com | grep -q Success;
          if [[ $$? == 0 ]]; then
            echo "Wordpress Installed Successfully";

            wp plugin list of plugins go here;
            wp db query < /var/www/html/wp-content/uploads/setup/SomeDatabaseSetupScript.sql;

            wp user update $WORDPRESS_ADMIN_USER --first_name=FirstName --last_name=LastName;

            wp role create somerole SomeRole;
            wp cap add 'somecapability' 'Some_Capability';

            wp import /var/www/html/wp-content/uploads/setup/SomeWordpressExport.xml --authors=/var/www/html/wp-content/uploads/setup/User-Mapping.csv | grep -q "Success: Finished importing";

            if [[ $$? == 0 ]]; then
              echo "Success: Finished importing WordPress content from file.";
              wp theme activate SomeTheme;
              wp theme mod set SomeThemeModName SomeValue
            else
              echo "Error: Failed to import WordPress content from file.";
            fi
          else
            echo "WordPress either failed to install, or is already installed";
          fi
          '
      volumes:
          - wp_data:/var/www/html
          - type: bind
            source: .\html\wp-content\uploads
            target: /var/www/html/wp-content/uploads
          - type: bind
            source: .\html\wp-content\plugins
            target: /var/www/html/wp-content/plugins # for installing/activating plugins
          - type: bind
            source: .\html\wp-content\themes
            target: /var/www/html/wp-content/themes # for activating the theme
          - type: bind
            source: .\setup\
            target: /var/www/html/wp-content/uploads/setup
          - type: bind
            source: .\html\wp-content\upgrade
            target: /var/www/html/wp-content/upgrade # for installing plugins

  volumes:
      db_data: {}
      wp_data:

{% endhighlight %}
