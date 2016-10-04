---
layout: post
title: Microsoft Fakes - Visual Studios Ultimate Mistake
date: 2012-10-08 00:26
comments: true
categories: []
permalink: /blog/microsoft-fakes-visual-studios-ultimate-mistake/
---
Having just recently installed VS 2012 Ultimate, I naturally wanted to unit test a program I had begun coding. Being a big fan of <a href="http://en.wikipedia.org/wiki/Dependency_injection" title="Dependency Injection" target="_blank">Dependency Injection</a> and mocking, my first instinct was to <a href="http://nuget.org/" title="NuGet is a Visual Studio extension that makes it easy to install and update third-party libraries and tools in Visual Studio." target="_blank">Nuget</a> up a reference to <a href="http://code.google.com/p/moq/" title="The simplest mocking library for .NET and Silverlight" target="_blank">Moq</a> in my test project. I began to wonder what other options I might have new to me with VS 2012, and remembered reading that VS 2012 has natively subsumed the <a href="http://research.microsoft.com/en-us/projects/moles/" title="Moles is a lightweight framework for test stubs and detours in .NET that is based on delegates." target="_blank">Moles Framework</a>, and renamed it <a href="http://msdn.microsoft.com/en-us/library/hh549175(v=vs.110).aspx" title="Microsoft Fakes help you isolate the code you are testing by replacing other parts of the application with stubs or shims." target="_blank">Microsoft Fakes</a> after some modifications.

I was initially excited to try out Fakes, with the intention of using it with my team at work, once everyone, and our projects were upgraded to VS 2012. That excitement soon turned to disappointment when I found out that Microsoft Fakes is only supported on VS 2012 Ultimate. This is confusing, since pre-release information suggests that Fakes are available for Premium as well as Ultimate. See <a href="http://stackoverflow.com/" target="_blank">StackOverflow</a> user Chai's <a href="http://stackoverflow.com/a/11192269/444610" target="_blank">response</a> to user Dan Sorensen's question about <a href="http://stackoverflow.com/questions/11009332/how-do-i-add-a-fakes-assembly-in-vs-2012-professional-rc" target="_blank">adding a Fakes assembly to VS 2012 Professional RC</a>. Chai asked a similar question on Microsoft's Connect portal - possibly <a href="http://connect.microsoft.com/VisualStudio/feedback/details/746742/fakes-framework-is-not-available-in-vs12-premium" target="_blank">here</a> - and the answer was disconcerting.

<blockquote>The RC documentation was incorrect. Fakes are available only in VS Ultimate.</blockquote>

Unit testing should be integral to any software development team. The barrier to entry to testing technologies should be as low as possible. I can understand having tiered versions of <a href="http://www.microsoft.com/visualstudio/eng/products/compare" title="Compare editions of Visual Studio" target="_blank">Visual Studio</a>, and that not every developer is going to need to create architectural layer diagrams. That makes sense. What also makes sense is that <strong>every developer should be writing unit tests</strong>. 

Unit testing is something that is so foundational to development, that unit testing functionality, and by extension, functionality that enables unit testing, like Microsoft Fakes, should be available to all editions of Visual Studio.

Not everyone on my team has Visual Studio Ultimate. This means that they are unable to use Microsoft Fakes. This discourages the use of Fakes by the developers with Ultimate. I'm not going to push to get all my coworkers Ultimate. They shouldn't <em>need</em> Ultimate.

While I am currently disappointed and discouraged by Microsoft's decision, I am hopeful that Microsoft will reverse course and enable Fakes in versions of Visual Studio 2012 other than Ultimate.
