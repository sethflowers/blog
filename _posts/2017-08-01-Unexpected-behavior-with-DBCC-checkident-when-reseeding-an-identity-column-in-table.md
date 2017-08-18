---
layout: post
title: Unexpected behavior with DBCC checkident when reseeding an identity column in a table
date: 2017-08-01
comments: false
categories: []
---
If you are using a flavor of Sql Server, and have tables with identity columns, you may have run into a need to reseed the table.
You can reseed the identity using the [DBCC checkident](https://docs.microsoft.com/en-us/sql/t-sql/database-console-commands/dbcc-checkident-transact-sql) TSQL command. 

You need to be aware that this command might behave differently depending on if the table has had data in the past.

- If the table has never had any rows, or all rows were truncated, the first row inserted after using this command uses the value passed into the command as the identity.
- Otherwise, (at least on SQL Server 2016 SP1), the first row inserted will use the value passed into the command <em>plus</em> 1 (presumably the "increment" value of the identity column).

This behavior is partially documented, but it seems more like they are documenting a bug, rather then a feature, which they do not want to fix because it would break existing scripts.

The following script shows how it behaves, when a table has had data, and when it has never had data.

{% highlight sql %}
  create table A ([Id] int not null identity(1,1))
  
  insert into A default values
  select * from A -- Id = 1

  delete from A
  dbcc checkident('A', reseed, 0)

  insert into A default values
  select * from A -- Id = 1 again, as expected

  create table B ([Id] int not null identity(1,1))
  dbcc checkident('B', reseed, 0)

  insert into B default values
  select * from B -- Id = 0... ???
{% endhighlight %}

If for some reason you need to reseed a table that is empty, but may or may not have had data in the past, you can use something like the following that gives you the behavior you would expect:

{% highlight sql %}
  declare @ReseedValue int = (select case when exists(SELECT * FROM sys.identity_columns WHERE object_id = OBJECT_ID('dbo.B') AND last_value IS NOT NULL) then 0 else 1 end)
  dbcc checkident('B', reseed, @ReseedValue)
{% endhighlight %}

With this approach, regardless if anything has ever been in the table, the next record inserted will have an identity of 1.
