---
layout: post
title: Finding differences between two tables in SQL
date: 2019-02-04
comments: false
categories: [TSQL]
---
**Problem**

Sometimes you need to determine if there are any differences between two sets of data. For instance, I recently refactored a complicated view, which returns roughly 60k rows of 26 columns. The original view contained 7 [correlated subqueries](https://en.wikipedia.org/wiki/Correlated_subquery), which were bogging down performance. Pro-tip: don't use correlated subqueries. After removing all of the correlated subqueries, I wanted to see if the before and after resulted in any difference among the roughly 60k rows.

**Solution**

This is simple to do generically, with a combination of the [union](https://docs.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-union-transact-sql?view=sql-server-2017), [except, and intersect](https://docs.microsoft.com/en-us/sql/t-sql/language-elements/set-operators-except-and-intersect-transact-sql?view=sql-server-2017) set operators in T-SQL.

**Example**

For example, given the following SQL, which creates two tables that differ on their row with Id = 2, we can use this trick to see what is different:

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

**Caveat**

This approach does not let you know if there are duplicates in one table. For instance, if you have two rows in one table that are identical, and only one row in the second table that matches them, this query finds no differences between the tables. You may still need to rely on comparing the counts for a final verification. For instance, the following is an example of this verification when comparing two views:

{% highlight sql %}
  select * into #Expected from [dbo].[vw_SomeView]
  select * into #Actual from [dbo].[vw_SomeView_Modified]

  select * from #Expected union select * from #Actual
  except 
  select * from #Expected intersect select * from #Actual

  select count(1) from #Expected;
  select count(1) from #Actual;
{% endhighlight %}
