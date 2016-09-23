---
layout: post
title: Common Table Expression for Fibonacci
date: 2012-11-13 23:52
comments: true
categories: []
---
More for my amusement than anything; the following t-sql query utilizing a <a href="https://en.wikipedia.org/wiki/Common_table_expression#Common_table_expression" title="Common Table Expression" target="_blank">common table expression</a> can be used to show the beginning of the <a href="https://en.wikipedia.org/wiki/Fibonacci_number" title="Fibonacci Sequence" target="_blank">Fibonacci sequence</a>, as well as it's convergence and relationship with the <a href="https://en.wikipedia.org/wiki/Golden_ratio" title="Golden Ratio" target="_blank">golden ratio</a>.

{% highlight sql %}
;WITH [Fibonacci] AS
(
	SELECT 
		0 AS [Number],
		1 AS [NextNumber],
		1 AS [Index],
		CAST(NULL AS FLOAT) AS [Ratio]
	UNION ALL
	SELECT
		[NextNumber],
		[Number] + [NextNumber],
		[Index] + 1,
		CASE
			WHEN [Number] = 0 THEN NULL
			ELSE CAST([NextNumber] AS FLOAT) / [Number]
		END
	FROM
		[Fibonacci]
	WHERE
		[Index] &lt; 25
)
SELECT
	[Number],
	[Ratio] AS [Ratio approaching golden ratio]
FROM
	[Fibonacci]
{% endhighlight %}

Note that this is a more simple version of the fibonacci CTE found on <a href="http://sqlwithmanoj.wordpress.com/2011/05/23/cte-recursion-sequence-dates-factorial-fibonacci-series/" title="CTE Recursion | Sequence, Dates, Factorial, Fibonacci series" target="_blank">Manoj Pandey's</a> blog. I've simplified his CTE, removing an unnecessary field, only to complicate it up again with the additional ratio calculation.
