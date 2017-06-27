---
layout: post
title: GitHub - Make the code take up the full width of the browser
date: 2017-06-27 20:18
comments: false
categories: []
---
If you use GitHub, especially on a team, you've probably been annoyed when looking at code and the width of
the container for the code is less than the width of some of the lines of code.
The container provides no horizontal scrollbar, so in order to see the end of these long lines of code,
you've probably had to drag your mouse over the line, literally selecting to the end.

Without resorting to extensions, or user defined stylesheets, you could do either of the following:
- One hack to make this slightly easier is to pop into the dev tools, find the elements that aren't wide enough, and widen them.
- A slightly quicker way is to write some javascript that does the same thing, and add a bookmarklet that just executes the javascript.

These both have the drawback that they only work while viewing the page, and as soon as you refresh, the changes are gone.
For my purposes, this is fine, since I don't have to do this very often. So, I use the bookmark approach, which is defined below.

<strong>Javascript</strong>
{% highlight javascript %}
var makeFullWidth = function(element) {
  element.style.width = document.body.clientWidth + 'px';
};

var content = document.getElementsByClassName('repository-content')[0];
makeFullWidth(content);
makeFullWidth(content.closest('.container'));
{% endhighlight %}

<strong>Bookmarklet</strong><br>
Drag the following link to your bookmarks.<br>
<a href="javascript:var makeFullWidth = function(element) { element.style.width = document.body.clientWidth + 'px'; }; var content = document.getElementsByClassName('repository-content')[0]; makeFullWidth(content); makeFullWidth(content.closest('.container'));">GitHub Full Width</a>
