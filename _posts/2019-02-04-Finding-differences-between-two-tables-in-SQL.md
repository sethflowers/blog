---
layout: post
title: Finding differences between two tables in SQL
date: 2019-02-04
comments: false
categories: [TSQL]
---
Sometimes you need to determine if there are any differences between two sets of data. This is simple to do generically, with a combination of the [union](https://docs.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-union-transact-sql?view=sql-server-2017), [except, and intercept](https://docs.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-except-and-intersect-transact-sql?view=sql-server-2017) set operators in T-SQL.

For example, given the following SQL:
  {% highlight sql %}
  declare @Actual table ([Id] int, [First] nvarchar(30), [Last] nvarchar(30), [Age] int)
  insert into @Actual values
  (1, 'Jimmy', 'Woods', 8)
  ,(2, 'Mora', 'Grissom', 12)
  ,(3, 'Lucas', 'Barton', 12)


  declare @Expected table ([Id] int, [First] nvarchar(30), [Last] nvarchar(30), [Age] int)
  insert into @Expected values
  (1, 'Jimmy', 'Woods', 8)
  ,(2, 'Christine', 'Bateman', 38)
  ,(3, 'Lucas', 'Barton', 12)


  -- Get all the distinct rows combined, except for the rows they share,
  -- which gives us any differences between the two.
  select * from @Expected union select * from @Actual
  except 
  select * from @Expected intersect select * from @Actual
{% endhighlight %}

This will result in the following output:

|Id |First     |Last    |Age |
|---|----------|--------|----|
|2  |Christine |Bateman |38  |
|2  |Mora      |Grissom |12  |

