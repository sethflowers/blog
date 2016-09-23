---
layout: post
title: Dormant Bugs
date: 2013-09-06 03:19
comments: true
categories: []
---
<strong>Setup</strong>
Today I had to deal with a "show-stopper" bug for a project. Upon first glance it looked like the bug was just introduced in the latest development cycle. An area of the application that behaved normally prior to this round of development is now deviating from the spec, but only in certain scenarios. If it was introduced, that means I could have been the developer to introduce it, which is fine; <a href="http://www.codinghorror.com/blog/2004/10/we-make-shitty-software-with-bugs.html" title="we all write buggy code">we all write buggy code</a>. I would just rather not be the developer introducing this bug. I tend to think my code is clean, and elegant. And of course, I was interested in how my tests missed this.

<strong>Reproduction</strong>
After getting a backup of the QA database, I was able to reproduce the issue. This was a relief, since on the outset, it looked like it could have been a concurrency issue. Instead, it was easy to track down via debugging. What it boiled down to was something analogous to the following code:

{% highlight csharp %}
bool exists = list.Any(item => item.SomeType == "abc");

if (exists)
{
    return list.Where(item => item.SomeBoolean);
}
{% endhighlight %}

<strong>Context</strong>
At the time the code was written, if item.SomeType was "abc", then item.SomeBoolean would be true. In this case, the <a href="https://en.wikipedia.org/wiki/Converse_%28logic%29" title="converse">converse</a> was also true; if item.SomeBoolean was true, then item.SomeType was "abc". The two properties were <em>implicitly</em> <a href="https://en.wikipedia.org/wiki/Coupling_%28computer_programming%29" title="coupled">coupled </a>together.

<strong>Analysis</strong>
The problem is that we now have logic that depends on the coupling. What the developer wanted to return, was the items whose "SomeType" property was "abc" (trust me). Since he knew that this was the same as looking at the "SomeBoolean" property, he depended on that property for the return statement. The implicit nature of this coupling was manifested as a set of assumptions in the mind of the original developer, that guided the logic behind his code. That was a mouthful, but take a moment to grok it; understand what it means for other developers. The code worked, <em>at the time it was written</em>. However, it is <em>obviously</em> brittle. It is not future-proof. Well, it's the future now, and the logic no longer holds water. 

<strong>In other words</strong>
To frame the issue in other words, imagine writing a software system that manages people. You have a requirement to group people by their hair color. For some unknown reason, the requirement mandates that the app only needs to support blonds and brunettes. If this is the case, then getting a list of all people that do NOT have blond hair, is equal to getting a list of all people that have brown hair. Any developer worth his salt would never use that logic though. Six months down the road, you might get a new requirement to support red-heads, or white-hairs, or purple-hairs, or no-hairs. This means you have to be aware of the assumptions you've previously made, and correct them. This is doable, but we shouldn't <em>need</em> to. 

<strong>Back to reality</strong>
The "show-stopper" was not far removed from this hypothetical scenario. Your code should <strong>never</strong> make assumptions. This is <a href="https://en.wikipedia.org/wiki/Defensive_programming" title="defensive programming">defensive programming</a> 101. <del>Maybe I should similarly not make assumptions about the quality of the codebase.</del> There is a certain level of trust we need to have in our fellow programmers, and certain assumptions that we need to be able to make about a code base.
