---
layout: post
title: Finding the frequency of a request in Application Insights
date: 2019-02-11
comments: false
categories: [App-Insights]
---
The following Analytics query can be run in app insights to find the frequency of requests to a particular endpoint over time:

{% highlight sql %}
  requests 
  | extend 
      itemType = iif(itemType == 'request', itemType, "")
      ,request_url = iif(itemType == 'request', url, "") 
  | where 
      itemType == 'request' 
      and request_url matches regex 'your-url-regex'
      and timestamp >= ago(31d)
  | summarize count() by bin(timestamp, 1h)
  | render timechart
{% endhighlight %}
