---
layout: post
title: Fixing dates with exiftool on a google photos takeout library
date: 2021-01-18
comments: false
categories: [Google, Google Photos, Google Photos Takeout, exif, exiftool]
---

I recently exported all of my Google Photos data using their "Takeout" tool. This produced just over 220 gigs of photos and videos,
that was reduced to 130 gigs after I realized that they exported my albums as duplicate photos. If you stumbled upon this post,
you probably did something similar, and like me, you quickly realized that lots of your photos didn't have the proper dates.

Google claims that the dates aren't modified in the files that you originally provide to them. However, the Takeout process
produces not just the files you've uploaded to them, but corresponding json files for each file you've uploaded. 
These json files have metadata about the media files, such as the created date.

I initially searched for how to fix this problem, and found a couple of GitHub repos containing solutions.

* [https://github.com/mattwilson1024/google-photos-exif](https://github.com/mattwilson1024/google-photos-exif)
* [https://github.com/TheLastGimbus/GooglePhotosTakeoutHelper](https://github.com/TheLastGimbus/GooglePhotosTakeoutHelper)

One of them hadn't been updated in a few months, and the other looked more active, but had a new outstanding open issue about how
Google changed the folder structure for their Takout data, which broke their scripts. My takeout data happened to have the new folder structure.
If you are looking for a solution, you might want to check out both of these repos.

Alright, the following is what I intended on doing:

* Get acquainted with [https://exiftool.org/](exiftool), which is a popular utility to read and write the exif data in media files.
* Write a powershell script that does the following:
* Use exiftool to identify media files in my takout library that were missing dates
* Copy these media files into a staging area
* Copy the corresponding json files into a staging area with a normalized name
  * I say normalized, because because Google didn't always create the json files with the same naming convention.
    * For instance, if your media file was named abcde.jpg, most of the time, the json would be abcde.jpg.json.
    * Sometimes it would be abcde.jpeg.json (notice the e in jpeg).
    * Sometimes it would be abcde.json.
    * Sometimes it would abcd.jpg.json.
    * Sometimes there was no json file.
    * And other oddities that are frustrating.
* Modify the timestamp in the json files to be in my local timezone.
  * This is important, because if we didn't do this, the times would all be off in the files by 4 or 5 hours, depending on Daylight Savings.
  * Exiftool has a way to alter the time by an offset, but it doesn't take into account DST.
* Use exiftool to batch update all the files in the staging folder using the dates in their corresponding json files
* Use exiftool to batch update all the files in the staging folder still missing dates based on their filenames
  * This is helpful for files that didn't have a json file whose name was something like 2021-01-18.jpg.
* Use exiftool to identify files that were fixed in the staging folder, and then move these into a Fixed folder.

At this point, all the media files in the staging folder were missing dates. Actually, only some of them.
I realized that gifs use a different tag than jpgs, I ended up modifying the step that updates the media files to write both the tags,
which fixed the gifs, but I did not update my "reporting" logic to take this into account, since I had so few gifs missing dates, meaning
I had some false positives at the end.

Long story short - my takeout had around 23k files, half of which are probably media, and the rest json.
Of these, about 1500 were missing dates, of which all but about 20 were fixed by my script. The script is below.
Take it for what it's worth. It could use some love (parameterization, error-handling, etc), but I didn't care too much,
as I hopefully never have to use this again.

{% highlight ps %}

    function Create-OriginalFilesMissingDatesCSV() {
        ."C:\program files\exiftool.exe" -r -q -filename --ext html --ext mp4 --ext 3gp --ext json .\Takeout -if 'not $exif:datetimeoriginal' -csv > OriginalFilesMissingDates.csv
    }

    function Create-FilesMissingDatesAfterFixCSV() {
        ."C:\program files\exiftool.exe" -r -q -filename --ext html --ext mp4 --ext 3gp --ext json .\MissingDates -if 'not $exif:datetimeoriginal' -csv > FilesMissingDatesAfterFix.csv
    }

    function Get-FolderName() {
        param (
            $fullPath
        )

        return [System.IO.Path]::GetDirectoryName($fullPath);
    }

    function Get-FileName() {
        param (
            $fullPath
        )

        return [System.IO.Path]::GetFileName($fullPath);
    }

    function Get-FileNameWithoutExtension() {
        param (
            $fileName
        )

        return [System.IO.Path]::GetFileNameWithoutExtension($fileName);
    }

    function Get-FileExtension() {
        param (
            $fileName
        )

        return [System.IO.Path]::GetExtension($fileName);
    }

    function Get-JsonPaths () {
        param (
            $fullFileName
        )
        
        $paths = New-Object Collections.Generic.List[String]
        $fullPathWithoutExtension = join-path (Get-FolderName $fullFileName) (Get-FileNameWithoutExtension $fullFileName)
                        
        # Plus Json
        $paths.Add($fullFileName + ".json");
        
        # Minus Extension, plus Json
        $paths.Add($fullPathWithoutExtension + ".json");
        
        # Minus Extension and last char, plus Json
        $paths.Add($fullPathWithoutExtension.Substring(0, $fullPathWithoutExtension.length - 1) + ".json");
        
        # Some .jpg files have a .jpeg.json file
        if ((Get-FileExtension $fullFileName) -eq ".jpg") {
            $paths.Add($fullPathWithoutExtension + ".jpeg.json");
        } 
        
        # Some files have an -edited suffix, but don't have a json.
        # We can try to get the non-edited json paths for these files.
        if ($fullPathWithoutExtension.EndsWith("-edited")) {
            $nonEditedMediaPath = $fullPathWithoutExtension.Substring(0, $fullPathWithoutExtension.Length - "-edited".Length) + (Get-FileExtension $fullFileName)
            $paths.AddRange((Get-JsonPaths $nonEditedMediaPath))
        }

        # Powershell has an absolutely ridiculous way to return a typed list.
        return @(,$paths)
    }

    function Copy-FilesMissingDatesAndTheirJsonFile() {
        param (
            $rootPath,
            $missingDatesPath
        )

        Write-Log "File copy - Starting..."

        Import-Csv OriginalFilesMissingDates.csv | select-object -First 10000000 |
            foreach {
                # Create paths to the files in question

                # ./Takeout/Google Photos/Photos from 2011/164851_500612026600_191849341600_6448962_593910.jpg
                $mediaFileRelativePath = $_.SourceFile; 
                
                # C:\Temp\Google Photos Takeout\ModifiedTest\Takeout\Google Photos\Photos from 2011\166631_500610536600_191849341600_6448902_553178.jpg
                $mediaFileAbsolutePath = [System.IO.Path]::GetFullPath($rootPath + "\" + $mediaFileRelativePath);

                # C:\Temp\Google Photos Takeout\ModifiedTest\Modified\Takeout\Google Photos\Photos from 2011\166631_500610536600_191849341600_6448902_553178.jpg
                $newMediaFileAbsolutePath = [System.IO.Path]::GetFullPath($missingDatesPath + "\" + $mediaFileRelativePath);

                # C:\Temp\Google Photos Takeout\ModifiedTest\Modified\Takeout\Google Photos\Photos from 2011
                $newMediaFileFolder = split-path $newMediaFileAbsolutePath

                # C:\Temp\Google Photos Takeout\ModifiedTest\Takeout\Google Photos\Photos from 2011\164851_500612026600_191849341600_6448962_593910.jpg.json
                $jsonFilePath = $mediaFileAbsolutePath + ".json"

                # C:\Temp\Google Photos Takeout\ModifiedTest\Takeout\Google Photos\Photos from 2011\164851_500612026600_191849341600_6448962_593910.json
                $alternateJsonFilePath1 = [System.IO.Path]::ChangeExtension($mediaFileAbsolutePath, ".json")

                # C:\Temp\Google Photos Takeout\ModifiedTest\Takeout\Google Photos\Photos from 2012\IMG_20120408_171316
                $fullPathWithoutExtension = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($mediaFileAbsolutePath), [System.IO.Path]::GetFileNameWithoutExtension($mediaFileAbsolutePath))
                            
                # Some json paths are actually missing the last character of the media file name.
                $alternateJsonFilePath2 = $fullPathWithoutExtension.Substring(0, $fullPathWithoutExtension.length - 1) + ".json"
                
                # Create the new directory if it does not exist
                if ([System.IO.Directory]::Exists($newMediaFileFolder) -eq $false) {
                    [System.IO.Directory]::CreateDirectory($newMediaFileFolder)
                }
                
                # Copy the media file to the new location
                Copy-Item -LiteralPath $mediaFileAbsolutePath -Destination $newMediaFileFolder

                # Get potential JSON paths for the media file.
                $jsonPaths = Get-JsonPaths $mediaFileAbsolutePath

                # If any of them exist, copy them to the expected path in the staging area.
                foreach ($jsonPath in $jsonPaths) {
                    if ([System.IO.File]::Exists($jsonPath)) {
                        [System.IO.File]::Copy($jsonPath, $newMediaFileAbsolutePath + ".json");
                        break;
                    }
                }
            }

        Write-Log "File copy - Complete..."
    }

    function Fix-TimeZoneInJsonFiles() {
        param (
            $missingDatesPath
        )

        Write-Log "Correct TimeZone - Starting..."

        # Cache the local timezone and the unix time epoch
        $currentTimeZoneName = (Get-WmiObject win32_timezone).StandardName
        $currentTimeZone = [System.TimeZoneInfo]::FindSystemTimeZoneById($currentTimeZoneName)
        $origin = [System.DateTime]::new(1970, 1, 1, 0, 0, 0, 0, [System.DateTimeKind]::Utc)
            
        # Loop through all .json files under this folder recursively
        ls -r $missingDatesPath *.json |
        foreach {
            # Get the json content
            $json = (Get-Content -LiteralPath $_.FullName | ConvertFrom-JSON)

            # Update the timestamp timezone in the json file if it exists.
            # This is necessary, since I can't figure out how to properly convert from UTC in the exiftool,
            # with a conversion that takes into account DST.
            # Instead, I will just convert the value in the JSON file into a non UTC value.
            if ([bool]($json.PSobject.Properties.name -eq "photoTakenTime") -and
                [bool]($json.photoTakenTime.PSobject.Properties.name -eq "timestamp") -and
                [bool]([System.String]::IsNullOrWhiteSpace($json.photoTakenTime.timestamp) -ne $true)) {

                # Get the UTC timestamp from the Json file, and convert into a local DateTime.
                $timestampUTC = $json.photoTakenTime.timestamp
                $photoTakenTimeUtc = $origin.AddSeconds($timestampUTC)
                $photoTakenTimeLocal = [System.TimeZoneInfo]::ConvertTimeFromUtc($photoTakenTimeUtc, $currentTimeZone)
            
                # Convert the local Date time back into a timestamp, but this time as a local timestamp
                $diff = $photoTakenTimeLocal - $origin;
                $totalSecondsLocal = [System.Math]::Floor($diff.TotalSeconds);

                # Update the timestamp in the Json file to the local time
                $json.photoTakenTime.timestamp = $totalSecondsLocal.ToString()

                # Write the json file back to disk
                $json | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $_.FullName
            }
        }

        Write-Log "Correct TimeZone - Complete..."
    }

    function Move-FixedFiles() {
        param (
            $missingDatesPath,
            $fixedPath
        )

        Write-Log "Move Fixed Files - Starting..."

        ."C:\program files\exiftool.exe" -r -q -filename --ext html --ext json $missingDatesPath -if '$exif:datetimeoriginal' -csv |
            select-object -skip 1 | 
            foreach {
                $csvRow = $_;
                $fixedMediaPath = [System.IO.Path]::GetFullPath($csvRow.Split(',')[0]);
                $newPath = $fixedMediaPath.Replace($missingDatesPath, $fixedPath);
                $newDirectory = [System.IO.Path]::GetDirectoryName($newPath);

                if ([System.IO.Directory]::Exists($newDirectory) -eq $false) {
                    [System.IO.Directory]::CreateDirectory($newDirectory);
                }

                [System.IO.File]::Move($fixedMediaPath, $newPath);

                if ([System.IO.File]::Exists($fixedMediaPath + ".json")) {
                    [System.IO.File]::Move($fixedMediaPath + ".json", $newPath + ".json");
                }
            }

        Write-Log "Move Fixed Files - Complete..."
    }

    function Write-Log() {
        param (
            $message
        )

        $message
    }

    $rootPath = "C:\Temp\Google Photos Takeout\ModifiedTest"
    $originalsPath = Join-Path $rootPath "Takeout"
    $missingDatesPath = join-path $rootPath "MissingDates"
    $fixedPath = join-path $rootPath "Fixed"

    # Navigate to the root folder of our Google Photos.
    cd $rootPath

    # Create the CSV file for missing dates.
    Create-OriginalFilesMissingDatesCSV

    # Copy the files in the CSV file into a new folder for modification
    Copy-FilesMissingDatesAndTheirJsonFile $rootPath $missingDatesPath

    # Update the timezones in the json file to not be UTC, so we don't have to run 2 exiftool commands, 1 to set, and 1 to adjust.
    Fix-TimeZoneInJsonFiles $missingDatesPath

    # Run exiftool, updating the datetimeoriginal and filecreatedate based on the json files.
    ."C:\program files\exiftool.exe" -r --ext html --ext json --ext csv -tagsfromfile %d%f.%e.json -if 'not $exif:datetimeoriginal' -m -q -q -description '-datetimeoriginal<PhotoTakenTimeTimestamp' "-FileCreateDate<PhotoTakenTimeTimestamp" -d %s $missingDatesPath -overwrite_original -progress

    # Run exiftool again, updating the datetimeoriginal and filecreatedate based on the file names.
    ."C:\program files\exiftool.exe" -r -q -q --ext html --ext json -if 'not $exif:datetimeoriginal' "-DateTimeOriginal<Filename" "-FileCreateDate<Filename" $missingDatesPath -overwrite_original -progress

    # Calculate how many files don't have a datetimeoriginal after our update.
    ."C:\program files\exiftool.exe" -r -q -filename --ext html --ext json $missingDatesPath -if 'not $exif:datetimeoriginal' -csv | select-object -skip 1 | Measure-Object -Line

    # Move the fixed files into a Fixed folder
    Move-FixedFiles $missingDatesPath $fixedPath

    # Create the CSV file for missing dates for the files we could not fix.
    Create-FilesMissingDatesAfterFixCSV

{% endhighlight %}
