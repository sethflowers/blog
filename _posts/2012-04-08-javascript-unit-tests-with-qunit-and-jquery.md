---
layout: post
title: Javascript Unit Tests with QUnit and jQuery
date: 2012-04-08 02:49
comments: true
categories: []
---
Are you unit testing your <em>javascript </em> code? There are numerous javascript unit testing frameworks out in the wild; <a href="http://www.jsunit.net/" title="JsUnit" target="_blank">JsUnit</a>, <a href="http://code.google.com/p/rhinounit/" title="rhinounit" target="_blank">rhinounit</a>, <a href="http://docs.jquery.com/QUnit" title="QUnit" target="_blank">QUnit</a>, <a href="http://yuilibrary.com/projects/yeti/" title="YUI's Yeti" target="_blank">YUI's Yeti</a>, <a href="http://code.google.com/p/js-test-driver/wiki/GettingStarted" title="js-test-driver" target="_blank">js-test-driver</a>, etc. In fact, here is a <a href="http://stackoverflow.com/questions/300855/looking-for-a-better-javascript-unit-test-tool" target="_blank">stackoverflow</a> thread listing all of these and more. I've recently used <a href="http://docs.jquery.com/QUnit" title="QUnit" target="_blank">QUnit</a> which is a framework written on top of, and maintained by the folks over at <a href="http://jquery.com/" title="jQuery" target="_blank">jQuery</a>.

In order to use QUnit to test your javascript code, you create a single html page to house your tests. In the header of your page, you link to the jQuery script file, a QUnit script file, and a QUnit stylesheet. In the body of your html page, you insert the following markup, which will be used by QUnit as a console to output the results of your tests.
{% highlight html %}
    <h1 id="qunit-header">Your Test Header</h1>
    <h2 id="qunit-banner"></h2>
    <div id="qunit-testrunner-toolbar"></div>
    <h2 id="qunit-userAgent"></h2>
    <ol id="qunit-tests"></ol>
    <div id="qunit-fixture"></div>
{% endhighlight %}

Once these things are in place, you can begin writing unit tests for your javascript. To do this, QUnit provides a function called "test" which takes a string parameter that acts as the name of the test in the results, and a function parameter, which is just an anonymous function containing assertion type function calls to other QUnit <a href="http://docs.jquery.com/QUnit#API_documentation" title="QUnit functions" target="_blank">functions</a>. The <a href="http://docs.jquery.com/QUnit/test#nameexpectedtest" title="QUnit 'test' function signature" target="_blank">details of the test function</a> can be found on QUnits site. Let's say you were writing a math library, and decided to include an "add" function. A simple test for this function would look like:
{% highlight javascript %}
test("addition tests", function () {
    equal(add(2, 3), 5, "2 + 3 should equal 5");
});
{% endhighlight %}

Or how about a more complicated example. Let's say you were writing a genetic algorithm engine, and wanted to test your <a href="http://en.wikipedia.org/wiki/Crossover_(genetic_algorithm)" target="_blank">crossover</a> functions. Your functions and their tests might look like:
{% highlight javascript %}
        $(function () {

            var geneticAlgorithm = {
                onePointCrossOver: function (mom, dad, index) {
                    var result = [];

                    result[result.length] = mom.slice(0, index)
                        .concat(dad.slice(index));

                    result[result.length] = dad.slice(0, index)
                        .concat(mom.slice(index));

                    return result;
                },
                twoPointCrossOver: function (mom, dad, indexA, indexB) {
                    var indexAResult =
                        this.onePointCrossOver(mom, dad, indexA);
                        
                    return this.onePointCrossOver(
                        indexAResult[0], indexAResult[1], indexB);
                }
            };

            function compareResults(actual, expected) {
                equal(actual.length, expected.length, 
                    "The length should be the same.");
                equal(actual.length, 2, 
                    "There should be two children.");

                compareChild(actual[0], expected[0]);
                compareChild(actual[1], expected[1]);
            }

            function compareChild(actual, expected) {
                equal(actual.length, expected.length,
                    "The number of genes should be the same.");

                for (var i = 0; i < expected.length; i++) {
                    equal(actual[i], expected[i], 
                        "The gene at '" + i + "' should be the same.");
                }
            }

            module("Cross Over tests");

            test("onePointCrossOver tests", function () {
                var mom = [1, 2, 3, 4];
                var dad = [5, 6, 7, 8];

                var childA = [1, 2, 7, 8];
                var childB = [5, 6, 3, 4];

                var actual = geneticAlgorithm
                    .onePointCrossOver(mom, dad, 2);
                var expected = [childA, childB];

                compareResults(actual, expected);
            });

            test("twoPointCrossOver tests", function () {
                var mom = [1, 2, 3, 4, 5, 6];
                var dad = [7, 8, 9, 10, 11, 12];

                var childA = [1, 2, 9, 10, 5, 6];
                var childB = [7, 8, 3, 4, 11, 12];

                var actual = geneticAlgorithm
                    .twoPointCrossOver(mom, dad, 2, 4);
                var expected = [childA, childB];

                compareResults(actual, expected);
            });
        });
{% endhighlight %}

You can view the results of the tests <a href="/examples/crossovertests.htm" target="_blank">here</a>. Notice that you can click on each of the tests in the results to get more details. If any of the tests had failed, the failing tests would be marked in red, and expanded, showing the expected value, and the actual value, along with other helpful information.
